/**
 * Twitch Helix API client.
 *
 * Thin wrapper around the Twitch Helix REST API with automatic auth header
 * injection, rate-limit retry (429 + Retry-After), and structured errors.
 */

import type { AppTokenManager } from "../auth/app-token.js";
import type { ChannelLogSink } from "../types.js";

const HELIX_BASE = "https://api.twitch.tv/helix";

/** Maximum retries on 429 responses. */
const MAX_RETRIES = 2;

/** Fallback retry delay when Retry-After header is missing (seconds). */
const DEFAULT_RETRY_SECONDS = 2;

export interface HelixApiClientOptions {
  clientId: string;
  appTokenManager: AppTokenManager;
  /** User access token for user-scoped endpoints. */
  userAccessToken?: string;
  /** The broadcaster's Twitch user ID (needed for most endpoints). */
  broadcasterId: string;
  /** The bot's user ID (moderator_id / sender_id for moderation and chat endpoints). */
  botUserId: string;
  logger: ChannelLogSink;
}

export class HelixApiClient {
  private readonly clientId: string;
  private readonly appTokenManager: AppTokenManager;
  private readonly userAccessToken: string | undefined;
  readonly broadcasterId: string;
  readonly botUserId: string;
  private readonly logger: ChannelLogSink;

  constructor(opts: HelixApiClientOptions) {
    this.clientId = opts.clientId;
    this.appTokenManager = opts.appTokenManager;
    this.userAccessToken = opts.userAccessToken;
    this.broadcasterId = opts.broadcasterId;
    this.botUserId = opts.botUserId;
    this.logger = opts.logger;
  }

  // ---------------------------------------------------------------------------
  // Low-level helpers
  // ---------------------------------------------------------------------------

  private async authHeaders(scope: "app" | "user"): Promise<Record<string, string>> {
    const token =
      scope === "user" && this.userAccessToken
        ? this.userAccessToken
        : await this.appTokenManager.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      "Client-Id": this.clientId,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      scope: "app" | "user";
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    },
  ): Promise<T> {
    const url = new URL(`${HELIX_BASE}${path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers = await this.authHeaders(opts.scope);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || DEFAULT_RETRY_SECONDS;
        this.logger.warn?.(`Helix rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1})`);
        await sleep(retryAfter * 1000);
        continue;
      }

      if (res.status === 204) {
        return undefined as T;
      }

      const text = await res.text();
      if (!res.ok) {
        lastError = new Error(`Helix ${method} ${path} failed: ${res.status} ${text}`);
        // Don't retry non-429 errors
        break;
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }

    throw lastError ?? new Error(`Helix ${method} ${path} failed after retries`);
  }

  // ---------------------------------------------------------------------------
  // Stream Management
  // ---------------------------------------------------------------------------

  async getStreamInfo(broadcasterId?: string): Promise<HelixResponse<HelixStream>> {
    return this.request("GET", "/streams", {
      scope: "app",
      query: { user_id: broadcasterId ?? this.broadcasterId },
    });
  }

  async getChannelInfo(broadcasterId?: string): Promise<HelixResponse<HelixChannel>> {
    return this.request("GET", "/channels", {
      scope: "app",
      query: { broadcaster_id: broadcasterId ?? this.broadcasterId },
    });
  }

  async modifyChannelInfo(
    data: { title?: string; game_id?: string; tags?: string[] },
    broadcasterId?: string,
  ): Promise<void> {
    await this.request("PATCH", "/channels", {
      scope: "user",
      query: { broadcaster_id: broadcasterId ?? this.broadcasterId },
      body: data,
    });
  }

  // ---------------------------------------------------------------------------
  // Chat & Communication
  // ---------------------------------------------------------------------------

  async sendChatMessage(message: string, broadcasterId?: string): Promise<HelixResponse<HelixSendMessageResult>> {
    return this.request("POST", "/chat/messages", {
      scope: "user",
      body: {
        broadcaster_id: broadcasterId ?? this.broadcasterId,
        sender_id: this.botUserId,
        message,
      },
    });
  }

  async sendAnnouncement(
    message: string,
    color?: "blue" | "green" | "orange" | "purple" | "primary",
    broadcasterId?: string,
  ): Promise<void> {
    await this.request("POST", "/chat/announcements", {
      scope: "user",
      query: {
        broadcaster_id: broadcasterId ?? this.broadcasterId,
        moderator_id: this.botUserId,
      },
      body: { message, color: color ?? "primary" },
    });
  }

  async sendShoutout(toUserId: string, broadcasterId?: string): Promise<void> {
    await this.request("POST", "/chat/shoutouts", {
      scope: "user",
      query: {
        from_broadcaster_id: broadcasterId ?? this.broadcasterId,
        to_broadcaster_id: toUserId,
        moderator_id: this.botUserId,
      },
    });
  }

  async getChatters(
    broadcasterId?: string,
    opts?: { first?: number; after?: string },
  ): Promise<HelixPaginatedResponse<HelixChatter>> {
    return this.request("GET", "/chat/chatters", {
      scope: "user",
      query: {
        broadcaster_id: broadcasterId ?? this.broadcasterId,
        moderator_id: this.botUserId,
        first: opts?.first,
        after: opts?.after,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Polls
  // ---------------------------------------------------------------------------

  async createPoll(data: {
    title: string;
    choices: string[];
    duration: number;
  }): Promise<HelixResponse<HelixPoll>> {
    return this.request("POST", "/polls", {
      scope: "user",
      body: {
        broadcaster_id: this.broadcasterId,
        title: data.title,
        choices: data.choices.map((title) => ({ title })),
        duration: data.duration,
      },
    });
  }

  async endPoll(pollId: string, status: "TERMINATED" | "ARCHIVED"): Promise<HelixResponse<HelixPoll>> {
    return this.request("PATCH", "/polls", {
      scope: "user",
      body: {
        broadcaster_id: this.broadcasterId,
        id: pollId,
        status,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Predictions
  // ---------------------------------------------------------------------------

  async createPrediction(data: {
    title: string;
    outcomes: string[];
    prediction_window: number;
  }): Promise<HelixResponse<HelixPrediction>> {
    return this.request("POST", "/predictions", {
      scope: "user",
      body: {
        broadcaster_id: this.broadcasterId,
        title: data.title,
        outcomes: data.outcomes.map((title) => ({ title })),
        prediction_window: data.prediction_window,
      },
    });
  }

  async resolvePrediction(
    predictionId: string,
    status: "RESOLVED" | "CANCELED" | "LOCKED",
    winningOutcomeId?: string,
  ): Promise<HelixResponse<HelixPrediction>> {
    return this.request("PATCH", "/predictions", {
      scope: "user",
      body: {
        broadcaster_id: this.broadcasterId,
        id: predictionId,
        status,
        winning_outcome_id: winningOutcomeId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Clips
  // ---------------------------------------------------------------------------

  async createClip(broadcasterId?: string): Promise<HelixResponse<HelixCreateClipResult>> {
    return this.request("POST", "/clips", {
      scope: "user",
      query: { broadcaster_id: broadcasterId ?? this.broadcasterId },
    });
  }

  async getClips(opts?: {
    broadcaster_id?: string;
    first?: number;
  }): Promise<HelixResponse<HelixClip>> {
    return this.request("GET", "/clips", {
      scope: "app",
      query: {
        broadcaster_id: opts?.broadcaster_id ?? this.broadcasterId,
        first: opts?.first ?? 20,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Moderation
  // ---------------------------------------------------------------------------

  async banUser(
    userId: string,
    reason?: string,
    duration?: number,
  ): Promise<HelixResponse<HelixBanResult>> {
    const body: Record<string, unknown> = {
      data: {
        user_id: userId,
        ...(reason && { reason }),
        ...(duration !== undefined && { duration }),
      },
    };
    return this.request("POST", "/moderation/bans", {
      scope: "user",
      query: {
        broadcaster_id: this.broadcasterId,
        moderator_id: this.botUserId,
      },
      body,
    });
  }

  async unbanUser(userId: string): Promise<void> {
    await this.request("DELETE", "/moderation/bans", {
      scope: "user",
      query: {
        broadcaster_id: this.broadcasterId,
        moderator_id: this.botUserId,
        user_id: userId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Channel Points
  // ---------------------------------------------------------------------------

  async createReward(data: {
    title: string;
    cost: number;
    prompt?: string;
    is_enabled?: boolean;
  }): Promise<HelixResponse<HelixReward>> {
    return this.request("POST", "/channel_points/custom_rewards", {
      scope: "user",
      query: { broadcaster_id: this.broadcasterId },
      body: data,
    });
  }

  async updateReward(
    rewardId: string,
    data: { title?: string; cost?: number; prompt?: string; is_enabled?: boolean },
  ): Promise<HelixResponse<HelixReward>> {
    return this.request("PATCH", "/channel_points/custom_rewards", {
      scope: "user",
      query: { broadcaster_id: this.broadcasterId, id: rewardId },
      body: data,
    });
  }

  async getRewards(onlyManageable?: boolean): Promise<HelixResponse<HelixReward>> {
    return this.request("GET", "/channel_points/custom_rewards", {
      scope: "user",
      query: {
        broadcaster_id: this.broadcasterId,
        only_manageable_rewards: onlyManageable ? "true" : undefined,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  async getFollowers(opts?: {
    first?: number;
    after?: string;
  }): Promise<HelixPaginatedResponse<HelixFollower>> {
    return this.request("GET", "/channels/followers", {
      scope: "user",
      query: {
        broadcaster_id: this.broadcasterId,
        first: opts?.first ?? 20,
        after: opts?.after,
      },
    });
  }

  async getSubscribers(opts?: {
    first?: number;
    after?: string;
  }): Promise<HelixPaginatedResponse<HelixSubscriber>> {
    return this.request("GET", "/subscriptions", {
      scope: "user",
      query: {
        broadcaster_id: this.broadcasterId,
        first: opts?.first ?? 20,
        after: opts?.after,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helix response types
// ---------------------------------------------------------------------------

export interface HelixResponse<T> {
  data: T[];
}

export interface HelixPaginatedResponse<T> extends HelixResponse<T> {
  total?: number;
  pagination?: { cursor?: string };
}

export interface HelixStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  tags: string[];
}

export interface HelixChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  broadcaster_language: string;
  game_id: string;
  game_name: string;
  title: string;
  delay: number;
  tags: string[];
}

export interface HelixSendMessageResult {
  message_id: string;
  is_sent: boolean;
}

export interface HelixChatter {
  user_id: string;
  user_login: string;
  user_name: string;
}

export interface HelixPoll {
  id: string;
  broadcaster_id: string;
  title: string;
  choices: Array<{ id: string; title: string; votes: number }>;
  status: string;
  duration: number;
  started_at: string;
  ended_at?: string;
}

export interface HelixPrediction {
  id: string;
  broadcaster_id: string;
  title: string;
  outcomes: Array<{
    id: string;
    title: string;
    users: number;
    channel_points: number;
    color: string;
  }>;
  prediction_window: number;
  status: string;
  created_at: string;
  ended_at?: string;
  locked_at?: string;
  winning_outcome_id?: string;
}

export interface HelixCreateClipResult {
  id: string;
  edit_url: string;
}

export interface HelixClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  title: string;
  created_at: string;
  view_count: number;
  duration: number;
}

export interface HelixBanResult {
  broadcaster_id: string;
  moderator_id: string;
  user_id: string;
  created_at: string;
  end_time?: string;
}

export interface HelixReward {
  id: string;
  broadcaster_id: string;
  title: string;
  cost: number;
  prompt: string;
  is_enabled: boolean;
}

export interface HelixFollower {
  user_id: string;
  user_login: string;
  user_name: string;
  followed_at: string;
}

export interface HelixSubscriber {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  user_id: string;
  user_login: string;
  user_name: string;
  tier: string;
  is_gift: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
