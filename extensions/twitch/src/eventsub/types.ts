/**
 * EventSub WebSocket and event payload types.
 *
 * Covers the Twitch EventSub WebSocket transport messages and typed event
 * payloads for all subscription types used by the conduit integration.
 */

// ============================================================================
// WebSocket Transport Messages
// ============================================================================

/** Metadata present on every EventSub WebSocket message. */
export interface EventSubMessageMetadata {
  message_id: string;
  message_type:
    | "session_welcome"
    | "session_keepalive"
    | "notification"
    | "session_reconnect"
    | "revocation";
  message_timestamp: string;
  subscription_type?: string;
  subscription_version?: string;
}

/** session_welcome payload — sent once per WebSocket connection. */
export interface EventSubSessionWelcome {
  metadata: EventSubMessageMetadata & { message_type: "session_welcome" };
  payload: {
    session: {
      id: string;
      status: string;
      connected_at: string;
      keepalive_timeout_seconds: number | null;
      reconnect_url: string | null;
    };
  };
}

/** session_reconnect payload — Twitch tells us to reconnect to a new URL. */
export interface EventSubSessionReconnect {
  metadata: EventSubMessageMetadata & { message_type: "session_reconnect" };
  payload: {
    session: {
      id: string;
      status: string;
      reconnect_url: string;
    };
  };
}

/** notification payload — wraps a typed EventSub event. */
export interface EventSubNotification<T = unknown> {
  metadata: EventSubMessageMetadata & { message_type: "notification" };
  payload: {
    subscription: {
      id: string;
      type: string;
      version: string;
      status: string;
      condition: Record<string, string>;
      transport: { method: string; conduit_id?: string };
      created_at: string;
      cost: number;
    };
    event: T;
  };
}

/** revocation payload — subscription revoked by Twitch. */
export interface EventSubRevocation {
  metadata: EventSubMessageMetadata & { message_type: "revocation" };
  payload: {
    subscription: {
      id: string;
      type: string;
      version: string;
      status: string;
      condition: Record<string, string>;
      transport: { method: string; conduit_id?: string };
      created_at: string;
      cost: number;
    };
  };
}

export type EventSubMessage =
  | EventSubSessionWelcome
  | EventSubSessionReconnect
  | EventSubNotification
  | EventSubRevocation
  | { metadata: EventSubMessageMetadata; payload: unknown };

// ============================================================================
// Event Payloads
// ============================================================================

/** channel.chat.message */
export interface ChatMessageEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id: string;
  message: {
    text: string;
    fragments: Array<{
      type: string;
      text: string;
      cheermote?: unknown;
      emote?: unknown;
      mention?: { user_id: string; user_login: string; user_name: string };
    }>;
  };
  color: string;
  badges: Array<{ set_id: string; id: string; info: string }>;
  message_type: string;
  cheer?: { bits: number };
  reply?: {
    parent_message_id: string;
    parent_message_body: string;
    parent_user_id: string;
    parent_user_login: string;
    parent_user_name: string;
    thread_message_id: string;
    thread_user_id: string;
    thread_user_login: string;
    thread_user_name: string;
  };
  channel_points_custom_reward_id?: string;
  source_broadcaster_user_id?: string;
  source_broadcaster_user_login?: string;
  source_broadcaster_user_name?: string;
  source_message_id?: string;
  source_badges?: Array<{ set_id: string; id: string; info: string }>;
}

/** channel.chat.notification */
export interface ChatNotificationEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  chatter_is_anonymous: boolean;
  color: string;
  badges: Array<{ set_id: string; id: string; info: string }>;
  system_message: string;
  message_id: string;
  message: { text: string; fragments: unknown[] };
  notice_type: string;
  sub?: { sub_tier: string; is_prime: boolean; duration_months: number };
  resub?: {
    cumulative_months: number;
    duration_months: number;
    streak_months: number;
    sub_tier: string;
    is_prime: boolean;
    is_gift: boolean;
    gifter_is_anonymous: boolean | null;
    gifter_user_id: string | null;
    gifter_user_login: string | null;
    gifter_user_name: string | null;
  };
  sub_gift?: {
    duration_months: number;
    cumulative_total: number | null;
    recipient_user_id: string;
    recipient_user_login: string;
    recipient_user_name: string;
    sub_tier: string;
    community_gift_id: string | null;
  };
  community_sub_gift?: {
    id: string;
    total: number;
    sub_tier: string;
    cumulative_total: number | null;
  };
  gift_paid_upgrade?: {
    gifter_is_anonymous: boolean;
    gifter_user_id: string | null;
    gifter_user_login: string | null;
    gifter_user_name: string | null;
  };
  raid?: {
    user_id: string;
    user_login: string;
    user_name: string;
    viewer_count: number;
    profile_image_url: string;
  };
  announcement?: { color: string };
  bits_badge_tier?: { tier: number };
  charity_donation?: {
    charity_name: string;
    amount: { value: number; decimal_places: number; currency: string };
  };
}

/** stream.online */
export interface StreamOnlineEvent {
  id: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  type: "live" | "playlist" | "watch_party" | "premiere" | "rerun";
  started_at: string;
}

/** stream.offline */
export interface StreamOfflineEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
}

/** channel.update */
export interface ChannelUpdateEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  title: string;
  language: string;
  category_id: string;
  category_name: string;
  content_classification_labels: string[];
}

/** channel.follow (v2) */
export interface ChannelFollowEvent {
  user_id: string;
  user_login: string;
  user_name: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  followed_at: string;
}

/** channel.subscribe */
export interface ChannelSubscribeEvent {
  user_id: string;
  user_login: string;
  user_name: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  tier: string;
  is_gift: boolean;
}

/** channel.subscription.message (resub with message) */
export interface ChannelSubscriptionMessageEvent {
  user_id: string;
  user_login: string;
  user_name: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  tier: string;
  message: { text: string; emotes: Array<{ begin: number; end: number; id: string }> };
  cumulative_months: number;
  streak_months: number | null;
  duration_months: number;
}

/** channel.subscription.gift */
export interface ChannelSubscriptionGiftEvent {
  user_id: string | null;
  user_login: string | null;
  user_name: string | null;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  total: number;
  tier: string;
  cumulative_total: number | null;
  is_anonymous: boolean;
}

/** channel.raid */
export interface ChannelRaidEvent {
  from_broadcaster_user_id: string;
  from_broadcaster_user_login: string;
  from_broadcaster_user_name: string;
  to_broadcaster_user_id: string;
  to_broadcaster_user_login: string;
  to_broadcaster_user_name: string;
  viewers: number;
}

/** channel.cheer */
export interface ChannelCheerEvent {
  is_anonymous: boolean;
  user_id: string | null;
  user_login: string | null;
  user_name: string | null;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  message: string;
  bits: number;
}

/** channel.ban */
export interface ChannelBanEvent {
  user_id: string;
  user_login: string;
  user_name: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  moderator_user_id: string;
  moderator_user_login: string;
  moderator_user_name: string;
  reason: string;
  banned_at: string;
  ends_at: string | null;
  is_permanent: boolean;
}

/** channel.poll.begin / progress / end */
export interface ChannelPollEvent {
  id: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  title: string;
  choices: Array<{
    id: string;
    title: string;
    bits_votes: number;
    channel_points_votes: number;
    votes: number;
  }>;
  bits_voting: { is_enabled: boolean; amount_per_vote: number };
  channel_points_voting: { is_enabled: boolean; amount_per_vote: number };
  status?: "active" | "completed" | "terminated" | "archived";
  started_at: string;
  ends_at?: string;
  ended_at?: string;
}

/** channel.prediction.begin / progress / lock / end */
export interface ChannelPredictionEvent {
  id: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  title: string;
  outcomes: Array<{
    id: string;
    title: string;
    color: string;
    users?: number;
    channel_points?: number;
    top_predictors?: Array<{
      user_id: string;
      user_login: string;
      user_name: string;
      channel_points_won: number | null;
      channel_points_used: number;
    }>;
  }>;
  status?: "active" | "locked" | "resolved" | "canceled";
  started_at: string;
  locks_at?: string;
  locked_at?: string;
  ended_at?: string;
  winning_outcome_id?: string | null;
}

/** channel.hype_train.begin / progress / end */
export interface ChannelHypeTrainEvent {
  id: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  level: number;
  total: number;
  progress: number;
  goal: number;
  top_contributions: Array<{
    user_id: string;
    user_login: string;
    user_name: string;
    type: "bits" | "subscription" | "other";
    total: number;
  }>;
  last_contribution?: {
    user_id: string;
    user_login: string;
    user_name: string;
    type: "bits" | "subscription" | "other";
    total: number;
  };
  started_at: string;
  expires_at?: string;
  ended_at?: string;
  cooldown_ends_at?: string;
}

/** channel.channel_points_custom_reward_redemption.add */
export interface ChannelPointsRedemptionEvent {
  id: string;
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  user_id: string;
  user_login: string;
  user_name: string;
  user_input: string;
  status: "unfulfilled" | "fulfilled" | "canceled";
  reward: {
    id: string;
    title: string;
    cost: number;
    prompt: string;
  };
  redeemed_at: string;
}

// ============================================================================
// Event Map (for typed event dispatcher)
// ============================================================================

/** Maps subscription type strings to their event payload types. */
export interface EventSubEventMap {
  "channel.chat.message": ChatMessageEvent;
  "channel.chat.notification": ChatNotificationEvent;
  "channel.chat.message_delete": unknown;
  "channel.chat.clear": unknown;
  "stream.online": StreamOnlineEvent;
  "stream.offline": StreamOfflineEvent;
  "channel.update": ChannelUpdateEvent;
  "channel.follow": ChannelFollowEvent;
  "channel.subscribe": ChannelSubscribeEvent;
  "channel.subscription.message": ChannelSubscriptionMessageEvent;
  "channel.subscription.gift": ChannelSubscriptionGiftEvent;
  "channel.subscription.end": unknown;
  "channel.cheer": ChannelCheerEvent;
  "channel.raid": ChannelRaidEvent;
  "channel.ban": ChannelBanEvent;
  "channel.unban": unknown;
  "channel.moderator.add": unknown;
  "channel.moderator.remove": unknown;
  "channel.vip.add": unknown;
  "channel.vip.remove": unknown;
  "channel.poll.begin": ChannelPollEvent;
  "channel.poll.progress": ChannelPollEvent;
  "channel.poll.end": ChannelPollEvent;
  "channel.prediction.begin": ChannelPredictionEvent;
  "channel.prediction.progress": ChannelPredictionEvent;
  "channel.prediction.lock": ChannelPredictionEvent;
  "channel.prediction.end": ChannelPredictionEvent;
  "channel.hype_train.begin": ChannelHypeTrainEvent;
  "channel.hype_train.progress": ChannelHypeTrainEvent;
  "channel.hype_train.end": ChannelHypeTrainEvent;
  "channel.channel_points_custom_reward_redemption.add": ChannelPointsRedemptionEvent;
  "channel.channel_points_automatic_reward_redemption.add": unknown;
}

/** All supported EventSub subscription type strings. */
export type EventSubSubscriptionType = keyof EventSubEventMap;

// ============================================================================
// Conduit State
// ============================================================================

/** Persisted conduit state file shape. */
export interface ConduitState {
  conduitId: string;
  subscriptions: Record<string, string>;
  createdAt: string;
  lastConnected: string;
}

// ============================================================================
// EventSub Config
// ============================================================================

/** EventSub configuration block on TwitchAccountConfig. */
export interface TwitchEventSubConfig {
  enabled?: boolean;
  transport?: "websocket";
  shardCount?: number;
  subscriptions?: string[];
}

/** Helix API tool actions configuration block. */
export interface TwitchApiConfig {
  enabled?: boolean;
  actions?: string[];
}
