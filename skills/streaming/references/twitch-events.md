# Twitch EventSub Events Reference

Quick reference for all EventSub events the streaming skill monitors.

## Chat Events

### channel.chat.message
A user sends a chat message.
- `broadcaster_user_id`, `broadcaster_user_login`, `broadcaster_user_name`
- `chatter_user_id`, `chatter_user_login`, `chatter_user_name`
- `message_id`
- `message.text` — full message text
- `message.fragments[]` — parsed fragments (text, emote, mention, cheermote, etc.)
- `color` — user's chat color
- `badges[]` — array of `{ set_id, id, info }` (subscriber, moderator, vip, etc.)
- `cheer` — present if message contains bits: `{ bits: number }`
- `reply` — present if replying to another message: `{ parent_message_id, parent_user_id, parent_user_login, parent_message_body }`

### channel.chat.notification
System notifications in chat (subs, resubs, raids, gift subs).
- `broadcaster_user_id`, `chatter_user_id`
- `notice_type` — one of: `sub`, `resub`, `sub_gift`, `community_sub_gift`, `gift_paid_upgrade`, `prime_paid_upgrade`, `raid`, `unraid`, `pay_it_forward`, `announcement`, `bits_badge_tier`, `charity_donation`
- `message.text`, `message.fragments[]`
- Sub-type specific fields vary by `notice_type`

### channel.chat.message_delete
A message was deleted by a moderator.
- `message_id` — the deleted message ID

### channel.chat.clear
Chat was cleared by a moderator.

## Stream Lifecycle Events

### stream.online
Stream goes live.
- `id` — stream ID
- `broadcaster_user_id`, `broadcaster_user_login`, `broadcaster_user_name`
- `type` — `"live"`, `"playlist"`, or `"watch_party"`
- `started_at` — ISO timestamp

**Agent reaction:** Wait 2-3 min, then post go-live embed to Discord, assign live role.

### stream.offline
Stream goes offline.
- `broadcaster_user_id`, `broadcaster_user_login`, `broadcaster_user_name`

**Agent reaction:** Remove live role, optionally post session summary.

### channel.update
Channel info changed (title, category, language, etc.).
- `broadcaster_user_id`, `broadcaster_user_login`, `broadcaster_user_name`
- `title` — new stream title
- `language` — stream language
- `category_id`, `category_name` — new game/category
- `content_classification_labels[]` — CCL tags

**Agent reaction:** Post stream update embed to Discord (debounced, skip if <5 min since last).

## Community Events

### channel.follow (v2)
A user followed the channel.
- `user_id`, `user_login`, `user_name` — the follower
- `broadcaster_user_id`
- `followed_at` — ISO timestamp

**Agent reaction:** Thank in Twitch chat. Batch if follows come in bursts.

### channel.raid
Another channel raided this channel.
- `from_broadcaster_user_id`, `from_broadcaster_user_login`, `from_broadcaster_user_name`
- `to_broadcaster_user_id`, `to_broadcaster_user_login`, `to_broadcaster_user_name`
- `viewers` — number of viewers in the raid

**Agent reaction:** Thank in chat, auto-shoutout, auto-clip, post to Discord.

## Subscription Events

### channel.subscribe
New subscription (first-time sub).
- `user_id`, `user_login`, `user_name`
- `broadcaster_user_id`
- `tier` — `"1000"`, `"2000"`, or `"3000"` (Tier 1/2/3)
- `is_gift` — boolean

**Agent reaction:** Thank in Twitch chat.

### channel.subscription.message
Resub with message (user chose to share).
- `user_id`, `user_login`, `user_name`
- `broadcaster_user_id`
- `tier`
- `message.text`, `message.emotes[]`
- `cumulative_months` — total months subscribed
- `streak_months` — consecutive months (null if user hides streak)
- `duration_months` — months in this sub period

**Agent reaction:** Thank in chat, mention streak/cumulative months.

### channel.subscription.gift
Gift sub(s) to the community.
- `user_id`, `user_login`, `user_name` — the gifter
- `broadcaster_user_id`
- `tier`
- `total` — number of subs gifted in this event
- `cumulative_total` — total subs this user has gifted in the channel (null if anonymous)
- `is_anonymous` — boolean

**Agent reaction:** Thank the gifter in chat.

### channel.subscription.end
A subscription ended (not renewed).
- `user_id`, `broadcaster_user_id`
- `tier`, `is_gift`

No agent reaction needed (silent event for tracking).

## Monetization Events

### channel.cheer
User cheered with bits.
- `user_id`, `user_login`, `user_name` (null if anonymous)
- `broadcaster_user_id`
- `message` — the cheer message text
- `bits` — number of bits cheered
- `is_anonymous` — boolean

**Agent reaction:** Thank in chat. Extra enthusiasm for 1000+ bits.

## Interactive Events

### channel.poll.begin
A poll started.
- `id` — poll ID
- `broadcaster_user_id`
- `title`
- `choices[]` — `{ id, title }`
- `started_at`, `ends_at`

### channel.poll.progress
Poll vote counts updated.
- Same as begin, plus `choices[].votes`, `choices[].channel_points_votes`, `choices[].bits_votes`

### channel.poll.end
Poll finished.
- Same as progress, plus `status` (`"completed"`, `"archived"`, `"terminated"`)
- `ended_at`

**Agent reaction:** Announce results in chat.

### channel.prediction.begin
A prediction started.
- `id` — prediction ID
- `broadcaster_user_id`
- `title`
- `outcomes[]` — `{ id, title, color }`
- `started_at`, `locks_at`

### channel.prediction.progress
Prediction point totals updated.
- Same as begin, plus `outcomes[].users`, `outcomes[].channel_points`

### channel.prediction.lock
Prediction locked (no more entries).
- Same as progress, plus `locked_at`

### channel.prediction.end
Prediction resolved or canceled.
- Same as progress, plus `status` (`"resolved"`, `"canceled"`), `ended_at`
- `winning_outcome_id` (if resolved)

**Agent reaction:** Announce results in chat.

### channel.hype_train.begin
Hype train started.
- `id`, `broadcaster_user_id`
- `total` — current total points
- `progress` — points toward next level
- `goal` — points needed for next level
- `level` — current level (starts at 1)
- `started_at`, `expires_at`

**Agent reaction:** Announce in chat.

### channel.hype_train.progress
Hype train leveled up.
- Same as begin with updated `level`, `total`, `progress`, `goal`

**Agent reaction:** Announce new level in chat.

### channel.hype_train.end
Hype train ended.
- `level` — final level reached
- `total` — total points earned
- `started_at`, `ended_at`

**Agent reaction:** Announce final level. Post to Discord if level 3+.

## Channel Points Events

### channel.channel_points_custom_reward_redemption.add
User redeemed a custom channel point reward.
- `id` — redemption ID
- `broadcaster_user_id`
- `user_id`, `user_login`, `user_name`
- `reward.id`, `reward.title`, `reward.cost`, `reward.prompt`
- `user_input` — text the user entered (if reward has input)
- `redeemed_at`
- `status` — `"unfulfilled"` or `"fulfilled"`

**Agent reaction:** Handle based on reward title (see SKILL.md for patterns).

### channel.channel_points_automatic_reward_redemption.add
User redeemed an automatic reward (highlight message, etc.).

## Moderation Events

### channel.ban
User banned from channel.
- `user_id`, `user_login`, `user_name`
- `broadcaster_user_id`
- `moderator_user_id`, `moderator_user_login`
- `reason`
- `banned_at`
- `ends_at` — null for permanent, ISO timestamp for timeouts
- `is_permanent` — boolean

### channel.unban
User unbanned from channel.
- `user_id`, `user_login`, `user_name`
- `moderator_user_id`, `moderator_user_login`

### channel.moderator.add / channel.moderator.remove
Moderator added or removed.
- `user_id`, `user_login`, `user_name`

### channel.vip.add / channel.vip.remove
VIP added or removed.
- `user_id`, `user_login`, `user_name`
