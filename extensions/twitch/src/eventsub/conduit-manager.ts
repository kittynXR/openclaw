/**
 * Conduit lifecycle manager for Twitch EventSub.
 *
 * Handles creating, verifying, and persisting conduits via the Twitch Helix API.
 * A conduit groups WebSocket shards together so EventSub subscriptions can be
 * attached to the conduit rather than individual transports.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AppTokenManager } from "../auth/app-token.js";
import type { ChannelLogSink } from "../types.js";
import type { ConduitState } from "./types.js";

const HELIX_BASE = "https://api.twitch.tv/helix";

/**
 * Manages a Twitch EventSub conduit — a server-side grouping of WebSocket shards.
 *
 * On startup, checks for a persisted conduit ID in the state file, verifies it
 * still exists via Helix, and creates a new one if needed. The conduit ID and
 * subscription metadata are persisted across restarts.
 */
export class ConduitManager {
  private readonly appTokenManager: AppTokenManager;
  private readonly clientId: string;
  private readonly accountId: string;
  private readonly shardCount: number;
  private readonly logger: ChannelLogSink;
  private readonly stateFilePath: string;

  private state: ConduitState | null = null;

  constructor(opts: {
    appTokenManager: AppTokenManager;
    clientId: string;
    accountId: string;
    shardCount: number;
    logger: ChannelLogSink;
  }) {
    this.appTokenManager = opts.appTokenManager;
    this.clientId = opts.clientId;
    this.accountId = opts.accountId;
    this.shardCount = opts.shardCount;
    this.logger = opts.logger;
    this.stateFilePath = join(
      homedir(),
      ".openclaw",
      "state",
      `twitch-conduit-${opts.accountId}.json`,
    );
  }

  /** Get the current conduit ID, or null if not yet initialized. */
  getConduitId(): string | null {
    return this.state?.conduitId ?? null;
  }

  /** Get the full persisted state (for subscription manager). */
  getState(): ConduitState | null {
    return this.state;
  }

  /**
   * Ensure a valid conduit exists — load from state, verify via API, or create new.
   *
   * @returns The conduit ID.
   */
  async ensureConduit(): Promise<string> {
    this.loadState();

    if (this.state?.conduitId) {
      const valid = await this.verifyConduit(this.state.conduitId);
      if (valid) {
        this.logger.info(`Using existing conduit ${this.state.conduitId}`);
        this.state.lastConnected = new Date().toISOString();
        this.saveState();
        return this.state.conduitId;
      }
      this.logger.warn(`Persisted conduit ${this.state.conduitId} no longer exists, creating new`);
    }

    const conduitId = await this.createConduit();
    this.state = {
      conduitId,
      subscriptions: {},
      createdAt: new Date().toISOString(),
      lastConnected: new Date().toISOString(),
    };
    this.saveState();
    return conduitId;
  }

  /**
   * Register a WebSocket session as a shard transport on the conduit.
   *
   * Must be called within 10 seconds of receiving the session_welcome message.
   */
  async updateConduitShard(shardId: number, sessionId: string): Promise<void> {
    const conduitId = this.state?.conduitId;
    if (!conduitId) {
      throw new Error("Cannot update shard: no conduit initialized");
    }

    const token = await this.appTokenManager.getAccessToken();
    const res = await fetch(`${HELIX_BASE}/eventsub/conduits/shards`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conduit_id: conduitId,
        shards: [
          {
            id: String(shardId),
            transport: {
              method: "websocket",
              session_id: sessionId,
            },
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to update conduit shard ${shardId}: ${res.status} ${text}`);
    }

    this.logger.info(`Registered shard ${shardId} (session ${sessionId}) on conduit ${conduitId}`);
  }

  /** Persist the subscription ID for a given type in the state file. */
  recordSubscription(type: string, subscriptionId: string): void {
    if (!this.state) return;
    this.state.subscriptions[type] = subscriptionId;
    this.saveState();
  }

  /** Clean up — currently a no-op since conduits persist server-side across restarts. */
  async cleanup(): Promise<void> {
    // Conduit + subscriptions persist server-side; only WS connections close.
    // We intentionally leave the conduit alive so reconnects are fast.
    this.logger.debug?.("Conduit cleanup: leaving conduit intact for fast reconnect");
  }

  // ---------- Private helpers ----------

  private async verifyConduit(conduitId: string): Promise<boolean> {
    try {
      const token = await this.appTokenManager.getAccessToken();
      const res = await fetch(`${HELIX_BASE}/eventsub/conduits`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": this.clientId,
        },
      });

      if (!res.ok) return false;

      const data = (await res.json()) as { data: Array<{ id: string }> };
      return data.data.some((c) => c.id === conduitId);
    } catch (err) {
      this.logger.warn(`Failed to verify conduit: ${String(err)}`);
      return false;
    }
  }

  private async createConduit(): Promise<string> {
    const token = await this.appTokenManager.getAccessToken();
    const res = await fetch(`${HELIX_BASE}/eventsub/conduits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ shard_count: this.shardCount }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to create conduit: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { data: Array<{ id: string }> };
    const conduitId = data.data[0]?.id;
    if (!conduitId) {
      throw new Error("Conduit creation returned no ID");
    }

    this.logger.info(`Created conduit ${conduitId} with ${this.shardCount} shard(s)`);
    return conduitId;
  }

  private loadState(): void {
    try {
      if (existsSync(this.stateFilePath)) {
        const raw = readFileSync(this.stateFilePath, "utf-8");
        this.state = JSON.parse(raw) as ConduitState;
      }
    } catch (err) {
      this.logger.warn(`Failed to load conduit state: ${String(err)}`);
      this.state = null;
    }
  }

  private saveState(): void {
    if (!this.state) return;
    try {
      const dir = dirname(this.stateFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      this.logger.warn(`Failed to save conduit state: ${String(err)}`);
    }
  }
}
