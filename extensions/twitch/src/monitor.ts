/**
 * Twitch message monitor - processes incoming messages and routes to agents.
 *
 * This monitor connects to the Twitch client manager, processes incoming messages,
 * resolves agent routes, and handles replies.
 */

import type { ReplyPayload, OpenClawConfig } from "../api.js";
import { createChannelReplyPipeline } from "../api.js";
import { checkTwitchAccessControl } from "./access-control.js";
import { getOrCreateClientManager } from "./client-manager-registry.js";
import { EventDispatcher } from "./eventsub/event-dispatcher.js";
import type { ChatMessageEvent } from "./eventsub/types.js";
import { getTwitchRuntime } from "./runtime.js";
import type { TwitchAccountConfig, TwitchChatMessage } from "./types.js";
import { stripMarkdownForTwitch } from "./utils/markdown.js";

export type TwitchRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type TwitchMonitorOptions = {
  account: TwitchAccountConfig;
  accountId: string;
  config: unknown; // OpenClawConfig
  runtime: TwitchRuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type TwitchMonitorResult = {
  stop: () => void;
  /** Event dispatcher for EventSub — created here so the monitor can subscribe before lifecycle starts. */
  eventDispatcher: EventDispatcher;
};

type TwitchCoreRuntime = ReturnType<typeof getTwitchRuntime>;

/**
 * Process an incoming Twitch message and dispatch to agent.
 */
async function processTwitchMessage(params: {
  message: TwitchChatMessage;
  account: TwitchAccountConfig;
  accountId: string;
  config: unknown;
  runtime: TwitchRuntimeEnv;
  core: TwitchCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, accountId, config, runtime, core, statusSink } = params;
  const cfg = config as OpenClawConfig;

  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: "twitch",
    accountId,
    peer: {
      kind: "group", // Twitch chat is always group-like
      id: message.channel,
    },
  });

  const rawBody = message.message;
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Twitch",
    from: message.displayName ?? message.username,
    timestamp: message.timestamp?.getTime(),
    envelope: core.channel.reply.resolveEnvelopeFormatOptions(cfg),
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `twitch:user:${message.userId}`,
    To: `twitch:channel:${message.channel}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "group",
    ConversationLabel: message.channel,
    SenderName: message.displayName ?? message.username,
    SenderId: message.userId,
    SenderUsername: message.username,
    Provider: "twitch",
    Surface: "twitch",
    MessageSid: message.id,
    OriginatingChannel: "twitch",
    OriginatingTo: `twitch:channel:${message.channel}`,
  });

  const storePath = core.channel.session.resolveStorePath(cfg.session?.store, {
    agentId: route.agentId,
  });
  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`Failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "twitch",
    accountId,
  });
  const { onModelSelected, ...replyPipeline } = createChannelReplyPipeline({
    cfg,
    agentId: route.agentId,
    channel: "twitch",
    accountId,
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      ...replyPipeline,
      deliver: async (payload) => {
        await deliverTwitchReply({
          payload,
          channel: message.channel,
          account,
          accountId,
          config,
          tableMode,
          runtime,
          statusSink,
        });
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}

/**
 * Deliver a reply to Twitch chat.
 */
async function deliverTwitchReply(params: {
  payload: ReplyPayload;
  channel: string;
  account: TwitchAccountConfig;
  accountId: string;
  config: unknown;
  tableMode: "off" | "plain" | "markdown" | "bullets" | "code";
  runtime: TwitchRuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { payload, channel, account, accountId, config, runtime, statusSink } = params;

  try {
    const clientManager = getOrCreateClientManager(accountId, {
      info: (msg) => runtime.log?.(msg),
      warn: (msg) => runtime.log?.(msg),
      error: (msg) => runtime.error?.(msg),
      debug: (msg) => runtime.log?.(msg),
    });

    const client = await clientManager.getClient(
      account,
      config as Parameters<typeof clientManager.getClient>[1],
      accountId,
    );
    if (!client) {
      runtime.error?.(`No client available for sending reply`);
      return;
    }

    // Send the reply
    if (!payload.text) {
      runtime.error?.(`No text to send in reply payload`);
      return;
    }

    const textToSend = stripMarkdownForTwitch(payload.text);

    await client.say(channel, textToSend);
    statusSink?.({ lastOutboundAt: Date.now() });
  } catch (err) {
    runtime.error?.(`Failed to send reply: ${String(err)}`);
  }
}

/**
 * Convert an EventSub ChatMessageEvent to the internal TwitchChatMessage format.
 *
 * This bridges EventSub's JSON payloads into the same shape used by the IRC
 * message pipeline, so `processTwitchMessage` works for both transports.
 */
function eventSubChatToTwitchMessage(event: ChatMessageEvent): TwitchChatMessage {
  const badges = event.badges ?? [];
  const hasBadge = (setId: string) => badges.some((b) => b.set_id === setId);

  return {
    username: event.chatter_user_login,
    userId: event.chatter_user_id,
    message: event.message.text,
    channel: event.broadcaster_user_login,
    displayName: event.chatter_user_name,
    id: event.message_id,
    timestamp: new Date(),
    isMod: hasBadge("moderator"),
    isOwner: event.chatter_user_id === event.broadcaster_user_id,
    isVip: hasBadge("vip"),
    isSub: hasBadge("subscriber"),
    chatType: "group",
  };
}

/**
 * Main monitor provider for Twitch.
 *
 * Sets up message handlers and processes incoming messages.
 * Creates an EventDispatcher that the plugin gateway passes to the EventSub
 * lifecycle so chat.message events flow through the same pipeline as IRC.
 */
export async function monitorTwitchProvider(
  options: TwitchMonitorOptions,
): Promise<TwitchMonitorResult> {
  const { account, accountId, config, runtime, abortSignal, statusSink } = options;

  const core = getTwitchRuntime();
  let stopped = false;

  const coreLogger = core.logging.getChildLogger({ module: "twitch" });
  const logVerboseMessage = (message: string) => {
    if (!core.logging.shouldLogVerbose()) {
      return;
    }
    coreLogger.debug?.(message);
  };
  const logger = {
    info: (msg: string) => coreLogger.info(msg),
    warn: (msg: string) => coreLogger.warn(msg),
    error: (msg: string) => coreLogger.error(msg),
    debug: logVerboseMessage,
  };

  const clientManager = getOrCreateClientManager(accountId, logger);

  try {
    await clientManager.getClient(
      account,
      config as Parameters<typeof clientManager.getClient>[1],
      accountId,
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    runtime.error?.(`Failed to connect: ${errorMsg}`);
    throw error;
  }

  // Set of message IDs seen via EventSub — used to deduplicate when IRC is also active
  const seenEventSubMessageIds = new Set<string>();

  const unregisterHandler = clientManager.onMessage(account, (message) => {
    if (stopped) {
      return;
    }

    // Access control check
    const botUsername = account.username.toLowerCase();
    if (message.username.toLowerCase() === botUsername) {
      return; // Ignore own messages
    }

    // Deduplicate: skip if this message was already processed via EventSub
    if (message.id && seenEventSubMessageIds.has(message.id)) {
      seenEventSubMessageIds.delete(message.id);
      return;
    }

    const access = checkTwitchAccessControl({
      message,
      account,
      botUsername,
    });

    if (!access.allowed) {
      return;
    }

    statusSink?.({ lastInboundAt: Date.now() });

    // Fire-and-forget: process message without blocking
    void processTwitchMessage({
      message,
      account,
      accountId,
      config,
      runtime,
      core,
      statusSink,
    }).catch((err) => {
      runtime.error?.(`Message processing failed: ${String(err)}`);
    });
  });

  // Create EventDispatcher for EventSub integration.
  // The plugin gateway passes this to startEventSub() so shard notifications
  // are routed here. We subscribe to channel.chat.message so EventSub chat
  // flows through the same processTwitchMessage pipeline.
  const eventDispatcher = new EventDispatcher(logger);

  const unsubscribeEventSub = eventDispatcher.on("channel.chat.message", (event) => {
    if (stopped) return;

    const message = eventSubChatToTwitchMessage(event);

    // Track message ID for dedup against IRC
    if (message.id) {
      seenEventSubMessageIds.add(message.id);
      // Clean up after a short delay to prevent unbounded growth
      setTimeout(() => seenEventSubMessageIds.delete(message.id!), 30_000);
    }

    // Access control check
    const botUsername = account.username.toLowerCase();
    if (message.username.toLowerCase() === botUsername) {
      return;
    }

    const access = checkTwitchAccessControl({ message, account, botUsername });
    if (!access.allowed) return;

    statusSink?.({ lastInboundAt: Date.now() });

    void processTwitchMessage({
      message,
      account,
      accountId,
      config,
      runtime,
      core,
      statusSink,
    }).catch((err) => {
      runtime.error?.(`EventSub message processing failed: ${String(err)}`);
    });
  });

  const stop = () => {
    stopped = true;
    unregisterHandler();
    unsubscribeEventSub();
    seenEventSubMessageIds.clear();
  };

  abortSignal.addEventListener("abort", stop, { once: true });

  return { stop, eventDispatcher };
}
