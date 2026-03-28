/**
 * EventSub subscription manager.
 *
 * Creates and manages EventSub subscriptions for configured event types,
 * using conduit transport. Idempotent: checks existing subscriptions before
 * creating new ones. Persists subscription IDs to the conduit state file.
 */

import type { AppTokenManager } from "../auth/app-token.js";
import type { ChannelLogSink } from "../types.js";
import type { ConduitManager } from "./conduit-manager.js";

const HELIX_BASE = "https://api.twitch.tv/helix";

/**
 * Subscription version map — most types use "1", but some require a specific version.
 * channel.chat.message and channel.chat.notification require "1" with user_id condition.
 * channel.follow requires "2".
 */
const SUBSCRIPTION_VERSIONS: Record<string, string> = {
  "channel.follow": "2",
  "channel.chat.message": "1",
  "channel.chat.notification": "1",
  "channel.chat.message_delete": "1",
  "channel.chat.clear": "1",
};

/**
 * Build the condition object for a subscription type.
 *
 * Most subscriptions need broadcaster_user_id. Chat-related subscriptions
 * additionally need user_id (the bot's user ID that has chat:read scope).
 */
function buildCondition(
  type: string,
  broadcasterId: string,
  userId?: string,
): Record<string, string> {
  const chatTypes = [
    "channel.chat.message",
    "channel.chat.notification",
    "channel.chat.message_delete",
    "channel.chat.clear",
  ];

  if (chatTypes.includes(type) && userId) {
    return { broadcaster_user_id: broadcasterId, user_id: userId };
  }

  // channel.follow v2 requires moderator_user_id
  if (type === "channel.follow" && userId) {
    return { broadcaster_user_id: broadcasterId, moderator_user_id: userId };
  }

  // channel.raid uses to_broadcaster_user_id
  if (type === "channel.raid") {
    return { to_broadcaster_user_id: broadcasterId };
  }

  return { broadcaster_user_id: broadcasterId };
}

interface ExistingSubscription {
  id: string;
  type: string;
  version: string;
  status: string;
  condition: Record<string, string>;
  transport: { method: string; conduit_id?: string };
}

/**
 * Manages EventSub subscriptions attached to a conduit.
 *
 * Creates subscriptions idempotently — skips types that already have an active
 * subscription on the same conduit. Records subscription IDs in the conduit
 * state file for tracking.
 */
export class SubscriptionManager {
  private readonly appTokenManager: AppTokenManager;
  private readonly conduitManager: ConduitManager;
  private readonly clientId: string;
  private readonly broadcasterId: string;
  private readonly userId: string | undefined;
  private readonly logger: ChannelLogSink;

  constructor(opts: {
    appTokenManager: AppTokenManager;
    conduitManager: ConduitManager;
    clientId: string;
    broadcasterId: string;
    userId?: string;
    logger: ChannelLogSink;
  }) {
    this.appTokenManager = opts.appTokenManager;
    this.conduitManager = opts.conduitManager;
    this.clientId = opts.clientId;
    this.broadcasterId = opts.broadcasterId;
    this.userId = opts.userId;
    this.logger = opts.logger;
  }

  /**
   * Ensure all requested subscription types are active on the conduit.
   *
   * Fetches existing subscriptions, skips already-active ones, and creates
   * any that are missing.
   */
  async ensureSubscriptions(types: string[]): Promise<void> {
    const conduitId = this.conduitManager.getConduitId();
    if (!conduitId) {
      throw new Error("Cannot create subscriptions: no conduit initialized");
    }

    const existing = await this.listExistingSubscriptions();

    // Index existing active subscriptions by type
    const activeByType = new Map<string, ExistingSubscription>();
    for (const sub of existing) {
      if (sub.status === "enabled" && sub.transport.conduit_id === conduitId) {
        activeByType.set(sub.type, sub);
      }
    }

    let created = 0;
    let skipped = 0;

    for (const type of types) {
      if (activeByType.has(type)) {
        const sub = activeByType.get(type)!;
        this.conduitManager.recordSubscription(type, sub.id);
        skipped++;
        continue;
      }

      try {
        const subId = await this.createSubscription(type, conduitId);
        this.conduitManager.recordSubscription(type, subId);
        created++;
      } catch (err) {
        this.logger.error(`Failed to create subscription for ${type}: ${String(err)}`);
      }
    }

    this.logger.info(`EventSub subscriptions: ${created} created, ${skipped} already active`);
  }

  // ---------- Private helpers ----------

  private async listExistingSubscriptions(): Promise<ExistingSubscription[]> {
    const token = await this.appTokenManager.getAccessToken();
    const subs: ExistingSubscription[] = [];
    let cursor: string | undefined;

    // Paginate through all subscriptions
    do {
      const url = new URL(`${HELIX_BASE}/eventsub/subscriptions`);
      if (cursor) url.searchParams.set("after", cursor);

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": this.clientId,
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.logger.warn(`Failed to list subscriptions: ${res.status} ${text}`);
        break;
      }

      const data = (await res.json()) as {
        data: ExistingSubscription[];
        pagination: { cursor?: string };
      };

      subs.push(...data.data);
      cursor = data.pagination?.cursor;
    } while (cursor);

    return subs;
  }

  private async createSubscription(type: string, conduitId: string): Promise<string> {
    const token = await this.appTokenManager.getAccessToken();
    const version = SUBSCRIPTION_VERSIONS[type] ?? "1";
    const condition = buildCondition(type, this.broadcasterId, this.userId);

    const body = {
      type,
      version,
      condition,
      transport: {
        method: "conduit",
        conduit_id: conduitId,
      },
    };

    const res = await fetch(`${HELIX_BASE}/eventsub/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${text}`);
    }

    const data = (await res.json()) as { data: Array<{ id: string }> };
    const subId = data.data[0]?.id;
    if (!subId) {
      throw new Error("Subscription creation returned no ID");
    }

    this.logger.debug?.(`Created subscription ${type} (${subId})`);
    return subId;
  }
}
