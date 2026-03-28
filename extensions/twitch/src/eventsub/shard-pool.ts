/**
 * WebSocket shard pool for Twitch EventSub conduit transport.
 *
 * Manages N WebSocket connections to wss://eventsub.wss.twitch.tv/ws, registers
 * each as a conduit shard on session_welcome, and forwards notification messages
 * to the event dispatcher. Handles reconnect messages and connection failures
 * with exponential backoff.
 */

import { WebSocket } from "ws";
import type { ChannelLogSink } from "../types.js";
import type { ConduitManager } from "./conduit-manager.js";
import type { EventDispatcher } from "./event-dispatcher.js";
import type {
  EventSubMessage,
  EventSubNotification,
  EventSubRevocation,
  EventSubSessionReconnect,
  EventSubSessionWelcome,
} from "./types.js";

const DEFAULT_WS_URL = "wss://eventsub.wss.twitch.tv/ws";

/** Must register shard within this window after session_welcome. */
const REGISTRATION_TIMEOUT_MS = 9_000;

/** Backoff parameters for reconnection. */
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 120_000;
const BACKOFF_MULTIPLIER = 2;

interface ShardState {
  id: number;
  ws: WebSocket | null;
  sessionId: string | null;
  url: string;
  backoffMs: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  registrationTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

/**
 * Manages a pool of WebSocket connections (shards) to Twitch EventSub.
 *
 * Each shard connects to the EventSub WebSocket endpoint. On receiving a
 * session_welcome, the shard is registered with the conduit within the
 * 10-second window. Notification messages are forwarded to the EventDispatcher.
 */
export class ShardPool {
  private readonly shards: ShardState[] = [];
  private readonly conduitManager: ConduitManager;
  private readonly dispatcher: EventDispatcher;
  private readonly logger: ChannelLogSink;
  private stopped = false;

  constructor(opts: {
    shardCount: number;
    conduitManager: ConduitManager;
    dispatcher: EventDispatcher;
    logger: ChannelLogSink;
  }) {
    this.conduitManager = opts.conduitManager;
    this.dispatcher = opts.dispatcher;
    this.logger = opts.logger;

    for (let i = 0; i < opts.shardCount; i++) {
      this.shards.push({
        id: i,
        ws: null,
        sessionId: null,
        url: DEFAULT_WS_URL,
        backoffMs: INITIAL_BACKOFF_MS,
        reconnectTimer: null,
        registrationTimer: null,
        stopped: false,
      });
    }
  }

  /** Connect all shards. */
  async start(): Promise<void> {
    this.stopped = false;
    this.logger.info(`Starting ${this.shards.length} EventSub WebSocket shard(s)`);

    // Use allSettled so one shard failing doesn't block the others
    const results = await Promise.allSettled(this.shards.map((s) => this.connectShard(s)));
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.error(`Shard connection failed: ${String(result.reason)}`);
      }
    }
  }

  /** Gracefully close all shards. */
  stop(): void {
    this.stopped = true;
    for (const shard of this.shards) {
      shard.stopped = true;
      this.cleanupShard(shard);
    }
    this.logger.info("All EventSub shards stopped");
  }

  // ---------- Shard lifecycle ----------

  private connectShard(shard: ShardState): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (shard.stopped || this.stopped) {
        resolve();
        return;
      }

      this.logger.debug?.(`Shard ${shard.id}: connecting to ${shard.url}`);
      const ws = new WebSocket(shard.url);
      shard.ws = ws;

      let welcomed = false;

      ws.on("open", () => {
        this.logger.debug?.(`Shard ${shard.id}: WebSocket open`);
        // Reset backoff on successful connection
        shard.backoffMs = INITIAL_BACKOFF_MS;
      });

      ws.on("message", (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(
            typeof raw === "string" ? raw : raw.toString("utf-8"),
          ) as EventSubMessage;
          this.handleMessage(shard, msg);

          // Resolve the connect promise on first welcome
          if (!welcomed && msg.metadata.message_type === "session_welcome") {
            welcomed = true;
            resolve();
          }
        } catch (err) {
          this.logger.error(`Shard ${shard.id}: failed to parse message: ${String(err)}`);
        }
      });

      ws.on("close", (code, reason) => {
        this.logger.warn(`Shard ${shard.id}: closed (${code} ${reason.toString("utf-8")})`);
        shard.ws = null;
        shard.sessionId = null;

        if (!welcomed) {
          // Never got welcome — reject this initial connect attempt
          reject(new Error(`Shard ${shard.id}: connection closed before welcome (${code})`));
          return;
        }

        this.scheduleReconnect(shard);
      });

      ws.on("error", (err) => {
        this.logger.error(`Shard ${shard.id}: WebSocket error: ${String(err)}`);
        // The close event will fire after error and handle reconnection
        if (!welcomed) {
          reject(err);
        }
      });
    });
  }

  private handleMessage(shard: ShardState, msg: EventSubMessage): void {
    switch (msg.metadata.message_type) {
      case "session_welcome":
        this.handleWelcome(shard, msg as EventSubSessionWelcome);
        break;
      case "session_reconnect":
        this.handleReconnect(shard, msg as EventSubSessionReconnect);
        break;
      case "notification":
        this.handleNotification(msg as EventSubNotification);
        break;
      case "revocation":
        this.handleRevocation(msg as EventSubRevocation);
        break;
      case "session_keepalive":
        // No-op: keepalives confirm the connection is alive
        break;
      default:
        this.logger.debug?.(`Shard ${shard.id}: unknown message type ${msg.metadata.message_type}`);
    }
  }

  private handleWelcome(shard: ShardState, msg: EventSubSessionWelcome): void {
    const session = msg.payload.session;
    shard.sessionId = session.id;

    this.logger.info(`Shard ${shard.id}: session_welcome (session=${session.id})`);

    // Register shard with conduit within the 10-second window
    if (shard.registrationTimer) clearTimeout(shard.registrationTimer);

    // Start a timer to warn if registration takes too long
    shard.registrationTimer = setTimeout(() => {
      this.logger.error(`Shard ${shard.id}: registration timeout — failed to register within 10s`);
    }, REGISTRATION_TIMEOUT_MS);

    void this.conduitManager
      .updateConduitShard(shard.id, session.id)
      .then(() => {
        if (shard.registrationTimer) {
          clearTimeout(shard.registrationTimer);
          shard.registrationTimer = null;
        }
      })
      .catch((err) => {
        if (shard.registrationTimer) {
          clearTimeout(shard.registrationTimer);
          shard.registrationTimer = null;
        }
        this.logger.error(`Shard ${shard.id}: failed to register with conduit: ${String(err)}`);
      });
  }

  private handleReconnect(shard: ShardState, msg: EventSubSessionReconnect): void {
    const newUrl = msg.payload.session.reconnect_url;
    this.logger.info(`Shard ${shard.id}: session_reconnect — reconnecting to ${newUrl}`);

    // Keep old connection open until new one is established
    const oldWs = shard.ws;
    shard.url = newUrl;

    void this.connectShard(shard)
      .then(() => {
        // Close old connection after new one is established
        oldWs?.close();
      })
      .catch((err) => {
        this.logger.error(`Shard ${shard.id}: reconnect to new URL failed: ${String(err)}`);
        // Fall back to default URL reconnection
        shard.url = DEFAULT_WS_URL;
        this.scheduleReconnect(shard);
      });
  }

  private handleNotification(msg: EventSubNotification): void {
    const type = msg.payload.subscription.type;
    this.dispatcher.dispatch(type, msg.payload.event);
  }

  private handleRevocation(msg: EventSubRevocation): void {
    const sub = msg.payload.subscription;
    this.logger.warn(
      `EventSub subscription revoked: ${sub.type} (${sub.id}) — status: ${sub.status}`,
    );
  }

  // ---------- Reconnection ----------

  private scheduleReconnect(shard: ShardState): void {
    if (shard.stopped || this.stopped) return;

    this.logger.info(`Shard ${shard.id}: reconnecting in ${shard.backoffMs}ms`);

    shard.reconnectTimer = setTimeout(() => {
      shard.reconnectTimer = null;
      shard.url = DEFAULT_WS_URL; // Reset to default on reconnect

      void this.connectShard(shard).catch((err) => {
        this.logger.error(`Shard ${shard.id}: reconnect failed: ${String(err)}`);
        // Increase backoff for next attempt
        shard.backoffMs = Math.min(shard.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
        this.scheduleReconnect(shard);
      });
    }, shard.backoffMs);

    // Increase backoff for next potential failure
    shard.backoffMs = Math.min(shard.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
  }

  // ---------- Cleanup ----------

  private cleanupShard(shard: ShardState): void {
    if (shard.reconnectTimer) {
      clearTimeout(shard.reconnectTimer);
      shard.reconnectTimer = null;
    }
    if (shard.registrationTimer) {
      clearTimeout(shard.registrationTimer);
      shard.registrationTimer = null;
    }
    if (shard.ws) {
      shard.ws.removeAllListeners();
      shard.ws.close();
      shard.ws = null;
    }
    shard.sessionId = null;
  }
}
