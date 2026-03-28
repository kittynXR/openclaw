/**
 * Helix API tool action handlers.
 *
 * Each exported handler maps a tool action name to a Helix API call.
 * Handlers receive the HelixApiClient + raw params, validate inputs,
 * and return a uniform { ok, data/error } result.
 */

import type { HelixApiClient } from "./api-client.js";

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  return { ok: true as const, data };
}

function fail(error: string) {
  return { ok: false as const, error };
}

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  throw new Error(`Missing required string parameter: ${key}`);
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  return String(v);
}

function requireNumber(params: Record<string, unknown>, key: string): number {
  const v = params[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`Missing required number parameter: ${key}`);
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

function requireStringArray(params: Record<string, unknown>, key: string): string[] {
  const v = params[key];
  if (Array.isArray(v) && v.length > 0 && v.every((item) => typeof item === "string")) {
    return v as string[];
  }
  throw new Error(`Missing required string array parameter: ${key}`);
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const v = params[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

export type HelixActionResult = { ok: true; data: unknown } | { ok: false; error: string };

type ActionHandler = (
  client: HelixApiClient,
  params: Record<string, unknown>,
) => Promise<HelixActionResult>;

// ---------------------------------------------------------------------------
// Stream Management
// ---------------------------------------------------------------------------

const getStreamInfo: ActionHandler = async (client, params) => {
  try {
    const res = await client.getStreamInfo(optionalString(params, "broadcaster_id"));
    const stream = res.data[0];
    return ok(
      stream
        ? {
            live: true,
            title: stream.title,
            game: stream.game_name,
            viewers: stream.viewer_count,
            started_at: stream.started_at,
            tags: stream.tags,
          }
        : { live: false },
    );
  } catch (e) {
    return fail(String(e));
  }
};

const getChannelInfo: ActionHandler = async (client, params) => {
  try {
    const res = await client.getChannelInfo(optionalString(params, "broadcaster_id"));
    const ch = res.data[0];
    return ch
      ? ok({
          broadcaster_name: ch.broadcaster_name,
          title: ch.title,
          game: ch.game_name,
          language: ch.broadcaster_language,
          tags: ch.tags,
        })
      : fail("Channel not found");
  } catch (e) {
    return fail(String(e));
  }
};

const modifyChannelInfo: ActionHandler = async (client, params) => {
  try {
    const data: Record<string, unknown> = {};
    const title = optionalString(params, "title");
    const gameId = optionalString(params, "game_id");
    const tags = params.tags;
    if (title) data.title = title;
    if (gameId) data.game_id = gameId;
    if (Array.isArray(tags)) data.tags = tags;

    if (Object.keys(data).length === 0) {
      return fail("At least one of title, game_id, or tags is required");
    }

    await client.modifyChannelInfo(data as { title?: string; game_id?: string; tags?: string[] });
    return ok({ updated: true });
  } catch (e) {
    return fail(String(e));
  }
};

// ---------------------------------------------------------------------------
// Chat & Communication
// ---------------------------------------------------------------------------

const sendChatMessage: ActionHandler = async (client, params) => {
  try {
    const message = requireString(params, "message");
    const res = await client.sendChatMessage(message, optionalString(params, "broadcaster_id"));
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

const sendAnnouncement: ActionHandler = async (client, params) => {
  try {
    const message = requireString(params, "message");
    const color = optionalString(params, "color") as
      | "blue"
      | "green"
      | "orange"
      | "purple"
      | "primary"
      | undefined;
    await client.sendAnnouncement(message, color);
    return ok({ sent: true });
  } catch (e) {
    return fail(String(e));
  }
};

const sendShoutout: ActionHandler = async (client, params) => {
  try {
    const toUserId = requireString(params, "to_user_id");
    await client.sendShoutout(toUserId);
    return ok({ sent: true });
  } catch (e) {
    return fail(String(e));
  }
};

const getChatters: ActionHandler = async (client, params) => {
  try {
    const res = await client.getChatters(optionalString(params, "broadcaster_id"), {
      first: optionalNumber(params, "first"),
      after: optionalString(params, "after"),
    });
    return ok({
      chatters: res.data,
      total: res.total,
      pagination: res.pagination,
    });
  } catch (e) {
    return fail(String(e));
  }
};

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

const createPoll: ActionHandler = async (client, params) => {
  try {
    const title = requireString(params, "title");
    const choices = requireStringArray(params, "choices");
    const duration = requireNumber(params, "duration");
    const res = await client.createPoll({ title, choices, duration });
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

const endPoll: ActionHandler = async (client, params) => {
  try {
    const pollId = requireString(params, "poll_id");
    const status = (optionalString(params, "status") ?? "TERMINATED") as "TERMINATED" | "ARCHIVED";
    const res = await client.endPoll(pollId, status);
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

const createPrediction: ActionHandler = async (client, params) => {
  try {
    const title = requireString(params, "title");
    const outcomes = requireStringArray(params, "outcomes");
    const predictionWindow = requireNumber(params, "prediction_window");
    const res = await client.createPrediction({
      title,
      outcomes,
      prediction_window: predictionWindow,
    });
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

const resolvePrediction: ActionHandler = async (client, params) => {
  try {
    const predictionId = requireString(params, "prediction_id");
    const status = requireString(params, "status") as "RESOLVED" | "CANCELED" | "LOCKED";
    const winningOutcomeId = optionalString(params, "winning_outcome_id");
    if (status === "RESOLVED" && !winningOutcomeId) {
      return fail("winning_outcome_id is required when status is RESOLVED");
    }
    const res = await client.resolvePrediction(predictionId, status, winningOutcomeId);
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

const createClip: ActionHandler = async (client, params) => {
  try {
    const res = await client.createClip(optionalString(params, "broadcaster_id"));
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

const getClips: ActionHandler = async (client, params) => {
  try {
    const res = await client.getClips({
      broadcaster_id: optionalString(params, "broadcaster_id"),
      first: optionalNumber(params, "first"),
    });
    return ok({ clips: res.data });
  } catch (e) {
    return fail(String(e));
  }
};

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

const banUser: ActionHandler = async (client, params) => {
  try {
    const userId = requireString(params, "user_id");
    const reason = optionalString(params, "reason");
    const res = await client.banUser(userId, reason);
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

const timeoutUser: ActionHandler = async (client, params) => {
  try {
    const userId = requireString(params, "user_id");
    const duration = requireNumber(params, "duration");
    const reason = optionalString(params, "reason");
    const res = await client.banUser(userId, reason, duration);
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

const unbanUser: ActionHandler = async (client, params) => {
  try {
    const userId = requireString(params, "user_id");
    await client.unbanUser(userId);
    return ok({ unbanned: true });
  } catch (e) {
    return fail(String(e));
  }
};

// ---------------------------------------------------------------------------
// Channel Points
// ---------------------------------------------------------------------------

const createReward: ActionHandler = async (client, params) => {
  try {
    const title = requireString(params, "title");
    const cost = requireNumber(params, "cost");
    const prompt = optionalString(params, "prompt");
    const isEnabled = optionalBoolean(params, "is_enabled");
    const res = await client.createReward({ title, cost, prompt, is_enabled: isEnabled });
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

const updateReward: ActionHandler = async (client, params) => {
  try {
    const rewardId = requireString(params, "reward_id");
    const data: Record<string, unknown> = {};
    const title = optionalString(params, "title");
    const cost = optionalNumber(params, "cost");
    const prompt = optionalString(params, "prompt");
    const isEnabled = optionalBoolean(params, "is_enabled");
    if (title) data.title = title;
    if (cost !== undefined) data.cost = cost;
    if (prompt) data.prompt = prompt;
    if (isEnabled !== undefined) data.is_enabled = isEnabled;

    const res = await client.updateReward(
      rewardId,
      data as { title?: string; cost?: number; prompt?: string; is_enabled?: boolean },
    );
    return ok(res.data[0]);
  } catch (e) {
    return fail(String(e));
  }
};

const getRewards: ActionHandler = async (client, params) => {
  try {
    const onlyManageable = optionalBoolean(params, "only_manageable");
    const res = await client.getRewards(onlyManageable);
    return ok({ rewards: res.data });
  } catch (e) {
    return fail(String(e));
  }
};

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const getFollowers: ActionHandler = async (client, params) => {
  try {
    const res = await client.getFollowers({
      first: optionalNumber(params, "first"),
      after: optionalString(params, "after"),
    });
    return ok({
      total: res.total,
      followers: res.data,
      pagination: res.pagination,
    });
  } catch (e) {
    return fail(String(e));
  }
};

const getSubscribers: ActionHandler = async (client, params) => {
  try {
    const res = await client.getSubscribers({
      first: optionalNumber(params, "first"),
      after: optionalString(params, "after"),
    });
    return ok({
      total: res.total,
      subscribers: res.data,
      pagination: res.pagination,
    });
  } catch (e) {
    return fail(String(e));
  }
};

// ---------------------------------------------------------------------------
// Action registry
// ---------------------------------------------------------------------------

/** All Helix action names. */
export const HELIX_ACTION_NAMES = [
  "get-stream-info",
  "get-channel-info",
  "modify-channel-info",
  "send-chat-message",
  "send-announcement",
  "send-shoutout",
  "get-chatters",
  "create-poll",
  "end-poll",
  "create-prediction",
  "resolve-prediction",
  "create-clip",
  "get-clips",
  "ban-user",
  "timeout-user",
  "unban-user",
  "create-reward",
  "update-reward",
  "get-rewards",
  "get-followers",
  "get-subscribers",
] as const;

export type HelixActionName = (typeof HELIX_ACTION_NAMES)[number];

/** Map of action name → handler function. */
export const helixActionHandlers: Record<HelixActionName, ActionHandler> = {
  "get-stream-info": getStreamInfo,
  "get-channel-info": getChannelInfo,
  "modify-channel-info": modifyChannelInfo,
  "send-chat-message": sendChatMessage,
  "send-announcement": sendAnnouncement,
  "send-shoutout": sendShoutout,
  "get-chatters": getChatters,
  "create-poll": createPoll,
  "end-poll": endPoll,
  "create-prediction": createPrediction,
  "resolve-prediction": resolvePrediction,
  "create-clip": createClip,
  "get-clips": getClips,
  "ban-user": banUser,
  "timeout-user": timeoutUser,
  "unban-user": unbanUser,
  "create-reward": createReward,
  "update-reward": updateReward,
  "get-rewards": getRewards,
  "get-followers": getFollowers,
  "get-subscribers": getSubscribers,
};
