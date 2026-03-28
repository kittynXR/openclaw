---
name: streaming
description: "Twitch + Discord streaming assistant. Manages streams, reacts to EventSub events, posts go-live/raid/update alerts to Discord with screenshots, manages live roles, and links user identities across platforms."
metadata:
  openclaw:
    emoji: "📺"
    requires:
      channels: ["twitch", "discord"]
---

# Streaming Skill

Twitch + Discord orchestration for content creators. You monitor Twitch EventSub events, manage the stream via Helix API tool actions, post alerts to Discord, manage live roles, and link user identities across platforms.

## When to Use

**USE this skill when:**
- User asks about their stream (viewers, title, category, uptime)
- EventSub events fire (follows, subs, raids, cheers, hype trains)
- Stream goes live/offline or title/category changes
- User wants to manage polls, predictions, clips, rewards
- User asks about Discord alerts or live role management
- User wants to link Twitch and Discord identities

**DON'T use this skill when:**
- General Discord server management unrelated to streaming
- Twitch account management (2FA, email, password)
- VOD editing or video production
- Non-streaming Twitch features (Drops campaigns, extensions marketplace)

## Configuration

The skill reads from the `streaming` config key:

```json5
{
  "streaming": {
    "twitch": {
      "autoShoutout": true,        // Auto-shoutout raiders
      "autoClipOnRaid": true       // Create clip when raided
    },
    "discord": {
      "serverId": "772344767865421824",
      "goLiveChannel": "#go-live",
      "goLivePingRole": "Stream Alerts",
      "raidAlertsChannel": "#raids",
      "streamUpdatesChannel": "#stream-updates",
      "liveRole": "\ud83d\udd34 Live Now",
      "updateDebounceMinutes": 5
    },
    "identity": {
      "autoMatchUsernames": true,
      "useTwitchConnections": true
    }
  }
}
```

## Stream Monitoring & Management

### Checking Stream Status

When the user asks "am I live?" or "how's the stream?", call `get-stream-info`:

```
tool: twitch
action: get-stream-info
```

This returns: stream type, title, game/category, viewer count, started-at timestamp. Calculate uptime from `started_at`. If the response has no stream data, the channel is offline.

### Updating Stream Info

When the user says "change title to X" or "switch to Just Chatting":

```
tool: twitch
action: modify-channel-info
params:
  title: "New Stream Title"
  game_id: "509658"   # Look up game ID first via get-channel-info
```

You can update `title`, `game_id`, and `tags` independently — only include the fields being changed.

### Creating Polls

```
tool: twitch
action: create-poll
params:
  title: "What should we play next?"
  choices: ["Elden Ring", "Baldur's Gate 3", "Stardew Valley"]
  duration: 120
```

Duration is in seconds (30-1800). To end early:

```
tool: twitch
action: end-poll
params:
  poll_id: "abc123"
  status: "TERMINATED"   # TERMINATED shows results, ARCHIVED hides them
```

### Creating Predictions

```
tool: twitch
action: create-prediction
params:
  title: "Will I beat this boss first try?"
  outcomes: ["Yes", "No way"]
  prediction_window: 120
```

To resolve:

```
tool: twitch
action: resolve-prediction
params:
  prediction_id: "pred_123"
  status: "RESOLVED"
  winning_outcome_id: "outcome_1"
```

Use `status: "LOCKED"` to stop new entries, `"CANCELED"` to refund all points.

### Creating Clips

```
tool: twitch
action: create-clip
```

Returns a clip URL. The clip captures roughly the last 30 seconds. Use this after memorable moments, raids, or on user request.

### Chat Actions

**Send a chat message:**
```
tool: twitch
action: send-chat-message
params:
  message: "Welcome to the stream!"
```

**Send a colored announcement:**
```
tool: twitch
action: send-announcement
params:
  message: "BIG NEWS: New emotes are live!"
  color: "purple"   # blue, green, orange, purple, or primary
```

**Shoutout a user:**
```
tool: twitch
action: send-shoutout
params:
  to_user_id: "12345"
```

### Moderation

**Ban a user:**
```
tool: twitch
action: ban-user
params:
  user_id: "12345"
  reason: "Repeated spam"
```

**Timeout a user:**
```
tool: twitch
action: timeout-user
params:
  user_id: "12345"
  duration: 600
  reason: "Chill out for 10 min"
```

**Unban:**
```
tool: twitch
action: unban-user
params:
  user_id: "12345"
```

### Channel Points

**Create a custom reward:**
```
tool: twitch
action: create-reward
params:
  title: "Hydration Check"
  cost: 500
  prompt: "Remind the streamer to drink water!"
```

**List rewards:**
```
tool: twitch
action: get-rewards
```

### Analytics

```
tool: twitch
action: get-followers
params:
  first: 20
```

```
tool: twitch
action: get-subscribers
```

---

## EventSub Event Reactions

You receive Twitch events via EventSub. React to each as described below. Always maintain a mental model of stream state (live/offline, current title, category, viewer count) by tracking events as they arrive.

### stream.online — Stream Goes Live

1. Update internal state: stream is now live.
2. Wait **2-3 minutes** before posting to Discord (Twitch needs time to generate the stream thumbnail).
3. Post a **go-live alert** to the configured Discord `goLiveChannel`:

```
Discord embed:
  Title: "\ud83d\udd34 {displayName} is live!"
  Description: "{stream title}"
  Field "Category": "{game/category name}"
  Image: https://static-cdn.jtvnw.net/previews-ttv/live_user_{username_lowercase}-1920x1080.jpg?t={unix_timestamp}
  URL: https://twitch.tv/{username}
  Color: #9146FF (Twitch purple)
  @mention: the configured goLivePingRole
```

The `?t={unix_timestamp}` parameter cache-busts to get a fresh thumbnail. Use `Date.now()` for the timestamp.

4. Assign the configured `liveRole` to the streamer's linked Discord account (if linked in identity store).

### stream.offline — Stream Goes Offline

1. Update internal state: stream is now offline.
2. Remove the `liveRole` from the streamer's linked Discord account.
3. Optionally post a stream summary to Discord if the user has configured it.

### channel.update — Title or Category Changed

1. Update internal state with new title/category.
2. **Debounce**: skip if fewer than `updateDebounceMinutes` (default 5) have passed since the last update post.
3. Post a **stream update** to the configured Discord `streamUpdatesChannel`:

```
Discord embed:
  Title: "\ud83d\udcfa Stream Updated"
  Field "Title": "{new title}"
  Field "Category": "{new category}"
  Image: https://static-cdn.jtvnw.net/previews-ttv/live_user_{username_lowercase}-1920x1080.jpg?t={unix_timestamp}
  Color: #9146FF
```

### channel.follow — New Follower

Thank the follower in Twitch chat:

```
tool: twitch
action: send-chat-message
params:
  message: "Welcome @{username}! Thanks for the follow \u2764\ufe0f"
```

Keep follow thanks brief and natural. Vary the wording. If follows come in bursts (follow bots or raids), batch them: "Welcome to all the new followers!" instead of spamming individual messages.

### channel.subscribe — New Subscription

Thank in Twitch chat:

```
tool: twitch
action: send-chat-message
params:
  message: "Thank you @{username} for subscribing! \ud83c\udf89"
```

### channel.subscription.message — Resub

Thank in Twitch chat, mention their streak/cumulative months:

```
tool: twitch
action: send-chat-message
params:
  message: "@{username} just resubbed for {cumulative_months} months! {streak_months}-month streak! \ud83d\udcaa Thank you!"
```

If the resub includes a message from the user, acknowledge it naturally.

### channel.subscription.gift — Gift Subs

Thank the gifter:

```
tool: twitch
action: send-chat-message
params:
  message: "@{username} just gifted {total} subs! You're incredible \ud83c\udf81"
```

### channel.raid — Incoming Raid

This is a multi-step reaction:

1. **Thank the raider in Twitch chat:**
```
tool: twitch
action: send-chat-message
params:
  message: "Welcome raiders! @{from_broadcaster} bringing {viewers} viewers! \ud83c\udf89"
```

2. **Auto-shoutout** (if `autoShoutout` is enabled):
```
tool: twitch
action: send-shoutout
params:
  to_user_id: "{from_broadcaster_user_id}"
```

3. **Auto-clip** (if `autoClipOnRaid` is enabled):
```
tool: twitch
action: create-clip
```

4. **Post raid alert to Discord** `raidAlertsChannel`:
```
Discord embed:
  Title: "\ud83c\udf89 Incoming Raid!"
  Description: "{from_broadcaster_name} raided with {viewers} viewers!"
  URL: https://twitch.tv/{from_broadcaster_login}
  Color: #FF6B6B
```

### channel.cheer — Bits / Cheers

Thank in Twitch chat:

```
tool: twitch
action: send-chat-message
params:
  message: "@{username} cheered {bits} bits! Thank you! \ud83d\udc8e"
```

For large cheers (1000+ bits), make the thank-you more enthusiastic.

### channel.hype_train.begin — Hype Train Started

Announce in Twitch chat and optionally in Discord:

```
tool: twitch
action: send-chat-message
params:
  message: "\ud83d\ude82 HYPE TRAIN STARTED! Let's gooo! Level 1"
```

### channel.hype_train.progress — Hype Train Level Up

```
tool: twitch
action: send-chat-message
params:
  message: "\ud83d\ude82 HYPE TRAIN LEVEL {level}! Keep it going!"
```

### channel.hype_train.end — Hype Train Complete

```
tool: twitch
action: send-chat-message
params:
  message: "\ud83d\ude82 Hype train reached LEVEL {level}! Amazing work chat!"
```

Post a summary to Discord `streamUpdatesChannel` if the hype train reached level 3+.

### channel.poll.begin / channel.prediction.begin

Acknowledge in chat that a poll or prediction is active. No special action needed — the streamer created these intentionally.

### channel.poll.end / channel.prediction.end

Announce results in chat:

```
tool: twitch
action: send-chat-message
params:
  message: "Poll results: '{winning_choice}' won with {votes} votes!"
```

### channel.channel_points_custom_reward_redemption.add — Reward Redemption

Handle based on the reward title. Common patterns:

- **"Hydration Check"** → `send-chat-message: "Taking a sip! Thanks @{user} \ud83d\udca7"`
- **"Change Stream Title"** → use `modify-channel-info` with the user's input
- **"VIP for a Day"** → note the redemption for the streamer to act on
- **Unknown rewards** → acknowledge the redemption in chat

---

## Discord Alerts (No Chat Bridge)

Discord integration is one-directional alerts only. There is NO chat bridging between Twitch and Discord. Discord receives:

1. **Go-live alerts** — when stream starts (with screenshot + role ping)
2. **Stream updates** — when title/category changes (with screenshot, debounced)
3. **Raid alerts** — when someone raids the channel
4. **Live role assignment** — managed on Discord members

### Screenshot URL Template

For all Discord embeds that include stream screenshots:

```
https://static-cdn.jtvnw.net/previews-ttv/live_user_{username_lowercase}-1920x1080.jpg?t={unix_timestamp}
```

- `{username_lowercase}`: broadcaster's Twitch login name, lowercased
- `{unix_timestamp}`: current Unix timestamp in milliseconds for cache-busting
- This URL is static and always available when the stream is live
- Twitch updates the thumbnail roughly every 5 minutes
- After `stream.online`, wait 2-3 minutes before fetching for a meaningful image

### Discord Embed Formatting

Use rich embeds for all Discord posts. Do NOT use markdown tables in Discord (they don't render). Structure:

- **Title**: short, with emoji prefix
- **Description**: one-line summary
- **Fields**: for structured data (Category, Viewers, etc.)
- **Image**: stream screenshot URL
- **URL**: link to Twitch channel
- **Color**: `#9146FF` for Twitch-branded, `#FF6B6B` for raids/alerts

---

## Live Role Management

Manage a Discord role (default: "\ud83d\udd34 Live Now") that indicates which server members are currently streaming on Twitch.

### Event-Driven (Primary)

For users with linked identities (Twitch <-> Discord):

- On `stream.online` → find the user's linked Discord account → assign the live role
- On `stream.offline` → find the user's linked Discord account → remove the live role

### Polling Fallback

For users without linked identities or as a periodic sync:

1. Every 5 minutes, get the list of Discord server members who have the streamer-linked role or are in the identity store.
2. For each, call `get-stream-info` with their `broadcaster_id` to check if they're live.
3. Assign or remove the live role accordingly.

Use the Twitch Helix API to batch-check streams:
```
tool: twitch
action: get-stream-info
params:
  broadcaster_id: "12345"
```

Check multiple users by calling `get-stream-info` for each linked identity.

---

## Cross-Platform User Identity

Link Twitch and Discord accounts so memory and context spans both platforms.

### Identity Store

Location: `~/.openclaw/state/streaming-identities.json`

Use the identity manager script at `skills/streaming/scripts/identity-manager.ts` for all operations. The store maps Twitch users to Discord users:

```json
{
  "identities": [
    {
      "id": "user_001",
      "twitch": {
        "userId": "123456",
        "username": "coolviewer",
        "displayName": "CoolViewer"
      },
      "discord": {
        "userId": "789012345678",
        "username": "coolviewer",
        "displayName": "Cool Viewer"
      },
      "linkedAt": "2026-03-28T00:00:00Z",
      "linkMethod": "auto-match"
    }
  ]
}
```

### Linking Methods

1. **Twitch Connections API** (most reliable): Query a Twitch user's connected accounts. If they have Discord linked, auto-create the identity mapping. Requires the user to have authorized the connection on Twitch.

2. **Auto-match by username** (if `autoMatchUsernames` enabled): When a user chats on one platform, check if a user with the same username exists on the other. Suggest the link but require confirmation before creating it.

3. **Manual linking**: User says "link my Twitch coolviewer to my Discord CoolViewer#1234". Create the mapping directly.

### Using Identities

When a user chats on either platform:

1. Look up their platform-specific ID in the identity store.
2. If found, load the unified user memory from `memory/users/{identity_id}.md`.
3. Use context from both platforms when responding.
4. Store new notes in the unified memory file.

When a user chats and has no linked identity:

1. If `autoMatchUsernames` is enabled, check for a matching username on the other platform.
2. If found, ask: "Are you also {username} on {other platform}? I can link your accounts for a better experience."
3. If confirmed, create the link.

---

## Session Tracking

Track stream session statistics mentally as events arrive:

- **New followers** this session
- **New subs / resubs / gift subs** this session
- **Bits cheered** this session
- **Raids** received this session
- **Peak viewer count** (update from `get-stream-info` periodically or from events)

When the user asks "how's the stream going?" or "stream summary", report these stats.

When `stream.offline` fires, compile a session summary. If the user has configured a Discord summary channel, post it there.

---

## Reference Docs

For detailed event payloads, see: `skills/streaming/references/twitch-events.md`
For all Helix tool action parameters, see: `skills/streaming/references/helix-actions.md`
For Discord embed formatting details, see: `skills/streaming/references/discord-integration.md`
