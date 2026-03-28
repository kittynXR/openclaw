# Helix API Tool Actions Reference

All 21 Helix API tool actions available via `tool: twitch`. Each action is called with `action: "<action-name>"` plus the listed parameters.

All actions return `{ ok: true, data: ... }` on success or `{ ok: false, error: "..." }` on failure.

## Stream Management

### get-stream-info
Get current stream status, viewer count, title, and category.
- `broadcaster_id` (optional) — defaults to configured broadcaster

Returns: stream type, title, game name, game ID, viewer count, started_at, language, tags, is_mature. Returns empty/null data if offline.

### get-channel-info
Get channel metadata (works even when offline).
- `broadcaster_id` (optional) — defaults to configured broadcaster

Returns: broadcaster details, title, game name, game ID, language, tags, content classification labels, delay.

### modify-channel-info
Update stream title, category, tags, or content classification labels.
- `title` (optional) — new stream title
- `game_id` (optional) — new game/category ID
- `tags` (optional) — array of tag strings

At least one parameter required. Look up `game_id` via `get-channel-info` or search.

## Chat & Communication

### send-chat-message
Send a message to the broadcaster's chat.
- `message` (required) — text to send
- `broadcaster_id` (optional) — defaults to configured broadcaster

### send-announcement
Send a colored announcement banner in chat.
- `message` (required) — announcement text
- `color` (optional) — `"blue"`, `"green"`, `"orange"`, `"purple"`, or `"primary"` (default)

### send-shoutout
Give a shoutout to another streamer.
- `to_user_id` (required) — Twitch user ID of the user to shoutout

Displays a shoutout card in chat with the user's stream info. Can only shoutout once per target per 2 minutes. Target must have streamed in the last 7 days.

### get-chatters
List users currently in chat.
- `broadcaster_id` (optional) — defaults to configured broadcaster
- `first` (optional) — number of results (max 1000)
- `after` (optional) — pagination cursor

Returns: array of `{ user_id, user_login, user_name }`.

## Interactive

### create-poll
Start a poll in chat.
- `title` (required) — poll question
- `choices` (required) — array of choice strings (2-5 choices)
- `duration` (required) — duration in seconds (30-1800)

Returns: poll ID, title, choices with IDs, timestamps.

### end-poll
End or archive a running poll.
- `poll_id` (required) — ID of the poll to end
- `status` (optional) — `"TERMINATED"` (shows results, default) or `"ARCHIVED"` (hides results)

### create-prediction
Start a channel points prediction.
- `title` (required) — prediction question
- `outcomes` (required) — array of outcome strings (2-10 outcomes)
- `prediction_window` (required) — seconds viewers have to predict (30-1800)

Returns: prediction ID, title, outcomes with IDs, timestamps.

### resolve-prediction
Lock, resolve, or cancel a prediction.
- `prediction_id` (required) — ID of the prediction
- `status` (required) — `"RESOLVED"`, `"CANCELED"`, or `"LOCKED"`
- `winning_outcome_id` (required if status is `"RESOLVED"`) — ID of the winning outcome

`LOCKED` stops new entries but doesn't resolve. `CANCELED` refunds all points.

## Clips

### create-clip
Create a clip of the current stream.
- `broadcaster_id` (optional) — defaults to configured broadcaster

Returns: clip ID and edit URL. Captures roughly the last 30 seconds. Stream must be live.

### get-clips
Get recent clips for the channel.
- `broadcaster_id` (optional) — defaults to configured broadcaster
- `first` (optional) — number of clips to return

Returns: array of clips with ID, URL, title, creator, view count, duration, created_at.

## Moderation

### ban-user
Permanently ban a user from the channel.
- `user_id` (required) — Twitch user ID to ban
- `reason` (optional) — ban reason

### timeout-user
Temporarily ban (timeout) a user.
- `user_id` (required) — Twitch user ID to timeout
- `duration` (required) — timeout duration in seconds (1-1209600, i.e. up to 14 days)
- `reason` (optional) — timeout reason

### unban-user
Remove a ban or timeout from a user.
- `user_id` (required) — Twitch user ID to unban

## Channel Points

### create-reward
Create a new custom channel point reward.
- `title` (required) — reward name
- `cost` (required) — channel points cost
- `prompt` (optional) — description/prompt shown to viewers
- `is_enabled` (optional) — whether the reward is active (default true)

### update-reward
Update an existing custom reward.
- `reward_id` (required) — ID of the reward to update
- `title` (optional) — new name
- `cost` (optional) — new cost
- `prompt` (optional) — new description
- `is_enabled` (optional) — enable/disable

### get-rewards
List all custom channel point rewards.
- `only_manageable` (optional) — if true, only return rewards the bot can manage

## Analytics

### get-followers
Get follower information for the channel.
- `first` (optional) — number of results to return
- `after` (optional) — pagination cursor

Returns: total follower count and array of followers with user info and followed_at.

### get-subscribers
Get subscriber information for the channel.
- `first` (optional) — number of results to return
- `after` (optional) — pagination cursor

Returns: total subscriber count, sub points, and array of subscribers with tier and user info.
