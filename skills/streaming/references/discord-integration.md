# Discord Integration Reference

How the streaming skill interacts with Discord. All Discord actions go through OpenClaw's built-in Discord channel — no additional bot setup needed.

## Core Principle: Alerts Only, No Chat Bridge

Discord integration is strictly one-directional alerts. The skill posts notifications TO Discord. It does NOT bridge chat between Twitch and Discord.

What goes to Discord:
- Go-live alerts (stream started)
- Stream updates (title/category changes)
- Raid alerts (incoming raids)
- Live role assignment/removal
- Hype train summaries (level 3+)
- Stream session summaries (optional)

What does NOT go to Discord:
- Twitch chat messages
- Individual follow/sub/cheer notifications (those stay in Twitch chat)
- Moderation actions

## Stream Screenshot URL

For embeds that include a stream preview image:

```
https://static-cdn.jtvnw.net/previews-ttv/live_user_{username}-1920x1080.jpg?t={timestamp}
```

- `{username}` — broadcaster's Twitch login name, **lowercased**
- `{timestamp}` — Unix timestamp in milliseconds (e.g. `1711584000000`) for cache-busting

Notes:
- URL is only valid when the stream is live
- Twitch updates the image roughly every 5 minutes
- After `stream.online`, wait **2-3 minutes** before using this URL (thumbnail needs time to populate)
- No authentication required — it's a public CDN URL

## Embed Templates

### Go-Live Alert

Post to: `goLiveChannel` (e.g. `#go-live`)

```json
{
  "embeds": [{
    "title": "\ud83d\udd34 StreamerName is live!",
    "description": "Building a streaming bot with OpenClaw",
    "url": "https://twitch.tv/streamername",
    "color": 9520895,
    "fields": [
      {
        "name": "Category",
        "value": "Science & Technology",
        "inline": true
      }
    ],
    "image": {
      "url": "https://static-cdn.jtvnw.net/previews-ttv/live_user_streamername-1920x1080.jpg?t=1711584000000"
    },
    "footer": {
      "text": "Twitch"
    },
    "timestamp": "2026-03-28T01:00:00Z"
  }],
  "content": "<@&ROLE_ID>"
}
```

The `content` field with `<@&ROLE_ID>` pings the configured `goLivePingRole`. Look up the role ID by name from the Discord server.

Color `9520895` = `#9146FF` (Twitch purple) in decimal.

### Stream Update

Post to: `streamUpdatesChannel` (e.g. `#stream-updates`)

```json
{
  "embeds": [{
    "title": "\ud83d\udcfa Stream Updated",
    "color": 9520895,
    "fields": [
      {
        "name": "Title",
        "value": "New stream title here",
        "inline": false
      },
      {
        "name": "Category",
        "value": "Just Chatting",
        "inline": true
      }
    ],
    "image": {
      "url": "https://static-cdn.jtvnw.net/previews-ttv/live_user_streamername-1920x1080.jpg?t=1711584000000"
    },
    "timestamp": "2026-03-28T02:30:00Z"
  }]
}
```

No role ping for updates — just informational.

Debounce: skip this post if fewer than `updateDebounceMinutes` (default: 5) have passed since the last stream update post.

### Raid Alert

Post to: `raidAlertsChannel` (e.g. `#raids`)

```json
{
  "embeds": [{
    "title": "\ud83c\udf89 Incoming Raid!",
    "description": "**RaiderName** raided with **247** viewers!",
    "url": "https://twitch.tv/raidername",
    "color": 16738155,
    "footer": {
      "text": "Twitch Raid"
    },
    "timestamp": "2026-03-28T03:00:00Z"
  }]
}
```

Color `16738155` = `#FF6B6B` in decimal.

### Hype Train Summary

Post to: `streamUpdatesChannel` (only if final level >= 3)

```json
{
  "embeds": [{
    "title": "\ud83d\ude82 Hype Train Complete!",
    "description": "The hype train reached **Level 5**!",
    "color": 9520895,
    "fields": [
      {
        "name": "Total Points",
        "value": "12,500",
        "inline": true
      },
      {
        "name": "Duration",
        "value": "8 minutes",
        "inline": true
      }
    ],
    "timestamp": "2026-03-28T02:45:00Z"
  }]
}
```

### Stream Session Summary (Optional)

Post to: `streamUpdatesChannel` (after `stream.offline`)

```json
{
  "embeds": [{
    "title": "\ud83d\udcca Stream Summary",
    "description": "StreamerName was live for 4h 32m",
    "color": 9520895,
    "fields": [
      { "name": "Peak Viewers", "value": "342", "inline": true },
      { "name": "New Followers", "value": "28", "inline": true },
      { "name": "New Subs", "value": "12", "inline": true },
      { "name": "Gift Subs", "value": "5", "inline": true },
      { "name": "Bits Cheered", "value": "3,200", "inline": true },
      { "name": "Raids", "value": "2", "inline": true }
    ],
    "timestamp": "2026-03-28T05:32:00Z"
  }]
}
```

## Discord Formatting Notes

- **No markdown tables** — Discord does not render markdown tables. Use embed fields for structured data.
- **Bold**: `**text**`
- **Italic**: `*text*`
- **Code**: `` `code` ``
- **Role mentions**: `<@&ROLE_ID>` — must use the numeric role ID, not the role name
- **User mentions**: `<@USER_ID>`
- **Channel mentions**: `<#CHANNEL_ID>`
- **Embed color**: must be a decimal integer, not a hex string
- **Embed limits**: title 256 chars, description 4096 chars, field name 256 chars, field value 1024 chars, max 25 fields
- **Image URLs**: must be HTTPS

## Live Role Management

### Role: "\ud83d\udd34 Live Now" (configurable via `liveRole`)

**Assigning the role:**
When a linked user's stream goes online (via `stream.online` event), find their Discord user ID from the identity store and assign the configured live role.

**Removing the role:**
When a linked user's stream goes offline (via `stream.offline` event), remove the live role from their Discord account.

**Polling fallback (every 5 minutes):**
1. Get all identities from `~/.openclaw/state/streaming-identities.json`
2. For each identity with both Twitch and Discord linked:
   - Call `get-stream-info` with their Twitch `broadcaster_id`
   - If live and doesn't have role → assign role
   - If offline and has role → remove role

### Role Lookup

To find the Discord role ID from the role name (e.g. "\ud83d\udd34 Live Now" or "Stream Alerts"):
- Use the Discord channel's server role list
- Match by name (case-insensitive)
- Cache the role ID after first lookup

## Channel Configuration

Map config names to Discord channels:

| Config Key | Default | Purpose |
|---|---|---|
| `goLiveChannel` | `#go-live` | Go-live alerts with role ping |
| `raidAlertsChannel` | `#raids` | Raid notifications |
| `streamUpdatesChannel` | `#stream-updates` | Title/category changes, hype trains, session summaries |

The agent resolves channel names (e.g. `#go-live`) to channel IDs via the Discord server's channel list. If a configured channel doesn't exist, warn the user and skip the post rather than erroring.
