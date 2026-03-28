/**
 * EventSub conduit lifecycle orchestrator.
 *
 * Coordinates startup of the app token manager, conduit, shard pool, and
 * subscription manager. Called from the plugin gateway when eventsub.enabled
 * is true.
 */

import { AppTokenManager } from "../auth/app-token.js";
import type { ChannelLogSink, TwitchAccountConfig } from "../types.js";
import { ConduitManager } from "./conduit-manager.js";
import { EventDispatcher } from "./event-dispatcher.js";
import { ShardPool } from "./shard-pool.js";
import { SubscriptionManager } from "./subscription-manager.js";

/** Default subscriptions if none are configured. */
const DEFAULT_SUBSCRIPTIONS = [
  "channel.chat.message",
  "channel.chat.notification",
  "stream.online",
  "stream.offline",
  "channel.update",
  "channel.subscribe",
  "channel.subscription.message",
  "channel.subscription.gift",
  "channel.cheer",
  "channel.raid",
  "channel.follow",
];

export interface EventSubLifecycleResult {
  dispatcher: EventDispatcher;
  stop: () => Promise<void>;
}

/**
 * Start the full EventSub conduit stack.
 *
 * 1. Create app token manager
 * 2. Ensure conduit exists (create or verify persisted)
 * 3. Start WebSocket shard pool
 * 4. Create EventSub subscriptions
 *
 * Returns the event dispatcher (for the monitor to subscribe to) and a stop function.
 */
export async function startEventSub(opts: {
  account: TwitchAccountConfig;
  accountId: string;
  /** Shared dispatcher — the monitor creates this so it can listen before EventSub starts. */
  dispatcher?: EventDispatcher;
  logger: ChannelLogSink;
}): Promise<EventSubLifecycleResult> {
  const { account, accountId, logger } = opts;
  const eventsub = account.eventsub!;

  if (!account.clientId) throw new Error("EventSub requires clientId");
  if (!account.clientSecret) throw new Error("EventSub requires clientSecret");
  if (!account.broadcasterId) throw new Error("EventSub requires broadcasterId");

  const shardCount = eventsub.shardCount ?? 1;
  const subscriptions = eventsub.subscriptions ?? DEFAULT_SUBSCRIPTIONS;

  // 1. App token manager
  const appTokenManager = new AppTokenManager({
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    logger,
  });

  // Pre-fetch a token to fail fast if credentials are bad
  await appTokenManager.getAccessToken();

  // Resolve the bot's user ID from the user access token (needed for chat subscriptions).
  // Chat EventSub conditions require the bot's user_id, not the broadcaster's.
  let botUserId: string | undefined;
  try {
    const cleanToken = account.accessToken.replace(/^oauth:/, "");
    const validateRes = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${cleanToken}` },
    });
    if (validateRes.ok) {
      const validateData = (await validateRes.json()) as { user_id?: string; login?: string };
      botUserId = validateData.user_id;
      logger.info(`Resolved bot user ID: ${botUserId} (${validateData.login})`);
    }
  } catch (err) {
    logger.warn(`Failed to resolve bot user ID from token: ${String(err)}`);
  }

  // 2. Conduit manager
  const conduitManager = new ConduitManager({
    appTokenManager,
    clientId: account.clientId,
    accountId,
    shardCount,
    logger,
  });

  await conduitManager.ensureConduit();

  // 3. Event dispatcher (use shared instance from monitor if provided)
  const dispatcher = opts.dispatcher ?? new EventDispatcher(logger);

  // 4. Shard pool
  const shardPool = new ShardPool({
    shardCount,
    conduitManager,
    dispatcher,
    logger,
  });

  await shardPool.start();

  // 5. Subscription manager
  const subscriptionManager = new SubscriptionManager({
    appTokenManager,
    conduitManager,
    clientId: account.clientId,
    broadcasterId: account.broadcasterId,
    // userId is the bot's user ID — needed for chat EventSub conditions.
    // Resolved from the user access token; falls back to broadcasterId.
    userId: botUserId ?? account.broadcasterId,
    logger,
  });

  await subscriptionManager.ensureSubscriptions(subscriptions);

  logger.info("EventSub conduit started successfully");

  // Stop function for cleanup
  const stop = async (): Promise<void> => {
    shardPool.stop();
    dispatcher.removeAllListeners();
    await conduitManager.cleanup();
    appTokenManager.invalidate();
    logger.info("EventSub conduit stopped");
  };

  return { dispatcher, stop };
}
