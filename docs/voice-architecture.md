# Voice architecture

Single source of truth for how Purrlor voice channels work: the two custom state events, the
LiveKit room-name algorithm, the token-server auth flow, which rooms a deployment will serve at
all, and the power-level → grant mapping.
Read this before touching anything under `apps/web/src/features/voice/`,
`apps/web/src/matrix/voice.ts`, `apps/web/src/matrix/channelType.ts`, or `services/token-server/`.

## Model

Discord's model, not cinny-voice's: voice is a **separate channel type**, not a toggle on every
room. One LiveKit deployment (and one token server) is configured **per Space** ("server," in
Discord terms) and shared by every voice channel inside it. Each voice channel (a normal Matrix
room, just marked as type `voice`) maps to its own LiveKit room, so multiple voice channels in
the same Space are independent calls — this is what "one LiveKit room per Matrix room" buys you.

## State events

Both are plain Matrix state events, state key `""`, following the same read/write/hook shape as
every other custom marker in this codebase (emotes, pins).

### `xyz.nekous.channel_type` — on a channel (room)

```json
{ "type": "voice" }
```

- Set once, atomically, in a room's `initial_state` at creation (`roomCreation.ts`). No UI to
  convert an existing channel's type after the fact in v1.
- Absence of the event means `text` — every room created before this feature existed, and every
  room created without explicitly choosing "Voice," is implicitly a text channel.
- Read via `readChannelType(room)` / `useChannelType(room)` (`src/matrix/channelType.ts`,
  `src/matrix/hooks/useChannelType.ts`).

### `xyz.nekous.voice_server` — on a Space

```json
{
  "url": "wss://livekit.example.com",
  "tokenEndpoint": "https://example.com/api/livekit/token",
  "botUserId": "@purrlor-voice-bot:example.com"
}
```

- The two URLs are required together — the LiveKit WS URL and the token-server HTTP endpoint are
  independent pieces of information; one isn't derivable from the other. `setVoiceServerConfig`
  refuses to write one without the other (enforced in the settings UI, not the SDK call itself).
- `botUserId` is the token server's membership bot (see "Service bot membership" below).
  Optional, and filled in automatically: the settings form asks the token server itself
  (`GET /api/livekit/config`) when the endpoint is entered, and a Space configured before this
  field existed back-fills it the first time an admin connects to one of its voice channels
  (`useVoiceConnection.ts`). It's stored in the Space's state rather than re-fetched per call so
  every member can read and act on it without an extra round trip.
- Set via `SpaceGeneralSettings.tsx`, gated the same way as name/topic/avatar edits
  (`canSendStateEvent`). Clearing both URL fields clears the config (written as an empty
  content — Matrix has no "delete a state event"), which also hands a sub-space back to
  inheriting its parent's.
- A sub-space with no config of its own inherits its parent's, walking up `m.space.parent`
  (`readVoiceServerConfig(mx, space)` in `src/matrix/voice.ts`). Depth-capped at 5 to guard
  against a pathological parent cycle.
- A room's owning Space (needed to look up its voice server) is found via the room's own
  `m.space.parent` event (`getParentSpace(mx, room)`) — every channel is created with one, so
  this only returns `undefined` for rooms that aren't a Space's child (DMs, group chats), which
  can't be voice channels in the first place.

## LiveKit room-name derivation

```
livekitRoomName(matrixRoomId) = "matrix-" + base64url(matrixRoomId, no padding)
```

Deterministic and reversible (base64, not a hash) so a LiveKit-side room name in logs or a
webhook payload can be mapped straight back to the Matrix room it belongs to without a lookup
table. Implemented identically — a small, ~5-line function — in both `apps/web` (`btoa`-based,
`src/matrix/voice.ts`) and `services/token-server` (`Buffer`-based,
`src/livekitRoomName.ts`), since the two don't share a package. Matrix room IDs are ASCII-only,
so `btoa` and UTF-8 `Buffer` encoding produce byte-identical output — for non-ASCII they would
genuinely disagree, which is why the vectors below contain none.

Each package asserts its own implementation against an identical list of golden vectors
(`livekitRoomName.vectors.ts`, duplicated verbatim in both). A change to either implementation
that isn't mirrored in both copies of that list fails a test — which matters more here than
usual, because the two sides disagreeing produces a call where nobody can hear anyone and
nothing, anywhere, reports an error.

## Token flow (client → token server → LiveKit)

1. Client calls `mx.getOpenIdToken()` on its own already-authenticated session. This returns
   `{ access_token, token_type, matrix_server_name, expires_in }` — a short-lived credential the
   client's *own* homeserver will vouch for to any third party.
2. Client `POST`s `{ openid_token: <that object>, room_id: <matrix room id> }` to the Space's
   configured `tokenEndpoint`.
3. Token server validates the OpenID token by asking the claimed homeserver to confirm it:
   `GET https://{matrix_server_name}/_matrix/federation/v1/openid/userinfo?access_token=...`.
   This is federation's standard "prove who I am to a third party" mechanism — it works for a
   user on **any** homeserver federated into the Space, not just the deployment's own.
   - The federation API is found by the spec's resolution order, not assumed to be at the
     server name (`services/token-server/src/openid.ts`): `.well-known/matrix/server`
     delegation, then `_matrix-fed._tcp` / `_matrix._tcp` SRV, then `{name}:8448`. A name with
     an explicit port, or a literal IP, is used as given. Results are cached for an hour.
     Worth knowing this hits a public endpoint over ordinary TLS rather than being a full
     federation client — it doesn't send the original server name as `Host` or validate the
     certificate against the delegated name, which a signed federation request would have to.
4. Token server checks the room is one this deployment serves at all (`src/tenancy.ts`) —
   see "Which rooms a deployment serves" below. Not served → `403 {"code": "room_not_served"}`.
   Step 3 proves *identity*, for a user on any homeserver in the world; this is the step that
   answers *entitlement*. Asked **before** anything is attempted in the room, deliberately:
   ordering it after the join attempt answered the far more specific "the bot isn't in the room"
   instead, which the client responds to by inviting the bot and waiting out a retry loop that
   could never succeed.
5. Token server checks the validated user is actually a member of `room_id`, via a persistent
   Matrix service-bot account kept joined to every gated room (`src/membership.ts`) — mirrors
   `element-hq/lk-jwt-service`'s approach instead of doing federation state resolution itself.
   Not a member → `403 {"code": "not_a_member"}`. The bot not being in the room is a separate
   answer — `409 {"code": "voice_bot_not_in_room", "botUserId": ...}` — see below.
6. Token server mints a LiveKit `AccessToken` scoped to `livekitRoomName(room_id)`, with grants
   from the member's power level (see below), and returns `{ token, roomName }`.
7. Client renders `<LiveKitRoom serverUrl={config.url} token={token} connect />`
   (`@livekit/components-react`), which owns the actual WebRTC connection lifecycle from there.

## Which rooms a deployment serves

`services/token-server/src/tenancy.ts`. This is the security boundary, and it exists because the
two halves of the design above pull in opposite directions: the OpenID flow deliberately
validates a user on **any** federated homeserver, and Matrix lets **anyone** send an invite. A
bot that auto-joined every invite, behind an endpoint that minted a token for any room the bot
was in, was reachable by the entire federation: create your own room, invite the bot, ask for a
token, and get one — with `roomAdmin`, since you're power level 100 in a room you created. Your
LiveKit deployment as free media relay for strangers.

Two gates, applied to every join *and* every token request:

1. **Local rooms only.** A room ID's server half names the homeserver the room was created on;
   it has to be the bot's own. The consequence is real and the client says so rather than
   letting it be discovered: a voice channel created by a **federated member** of your Space
   lives on *their* homeserver and will never be served. `CreateChannelModal` warns while the
   channel is still being created, and `useVoiceConnection` checks the room's server against the
   bot's before its first request (`isRoomOnBotHomeserver`) — without that the failure is
   indistinguishable from a bot that hasn't joined yet, and the client waits out a ~12s retry
   loop for something no invite can fix.
2. **A child of a Space this deployment serves.** Checked via the Space's own `m.space.child`,
   never the child room's `m.space.parent` — `m.space.parent` is written by the child, so any
   room can claim to belong to your Space, while `m.space.child` is Space state only the Space's
   admins can write.

Which Spaces count is `VOICE_ALLOWED_SPACES` (comma-separated room IDs) when set, plus any
sub-space of those the bot has also joined — matching the client's own inheritance of a parent
Space's voice config. Unset, it's every Space on this homeserver the bot has been invited into,
which is the right default for a private server: the homeserver's registration settings already
decide who can make a Space there. Set it on a deployment with open registration.

The Space membership is therefore load-bearing, not decorative — which is why saving a Space's
voice settings invites the bot to the **Space** (`SpaceGeneralSettings.tsx`), and reports it
rather than swallowing it if that invite fails.

A room checked and joined once is re-checked on every token request, so a channel unlinked from
its Space — or one the bot was walked into before this gate existed — stops being authorized
without anyone having to go and kick the bot out of it.

## Service bot membership

The bot has to be a **joined member of the voice channel's own room** before it can answer "is
this caller allowed in?". Matrix invites don't cascade from a Space to its children, so being in
a Space never *puts* the bot in the voice channels inside it — every voice channel needs its own
way in. That used to be a manual invite, of an account whose ID wasn't shown anywhere in the app,
and skipping it produced a bare `403 Not a member of this room` against a caller who was, in
fact, a member. It's now handled end to end:

- **The token server publishes its own bot ID** at `GET /api/livekit/config` → `{ botUserId }`,
  so nobody has to copy `MATRIX_BOT_USER_ID` out of the deployment's `.env` by hand.
- **Private voice channels are created `restricted` to their Space** (`roomCreation.ts`) rather
  than invite-only: `join_rule: "restricted"` with an `m.room_membership` allow rule naming the
  parent Space. Being in the Space is what grants access to its channels — Discord's model — and
  it means the bot can join a served channel *itself* rather than depending on an invite it has
  no way to ask for. It also makes the channel list's "Join" button work for private channels,
  which previously only ever worked for public ones. Needs room version 9+; `createRoom` retries
  invite-only if the homeserver rejects it, where the creation invite below is the only way in.
- **New voice channels invite it at creation** — `CreateChannelModal` passes it to
  `createRoom`'s `invite`, so the bot is in from the first moment even on a homeserver too old
  for restricted join rules, and without waiting to notice the channel.
- **Joining an older voice channel invites it on the spot** — `useVoiceConnection` calls
  `ensureVoiceBotInvited` (`src/matrix/voiceBot.ts`) before the token fetch, then retries the
  fetch for ~12s while the bot acts on that invite, showing "Setting up voice for this channel…"
  rather than an error. A user without the room's `invite` power level instead gets a message
  naming the bot and pointing at an admin.
- **The bot joins every voice channel ahead of time, without an invite.** A voice channel's
  `m.space.child` link carries `xyz.nekous.channel_type: "voice"` (written at creation, and added
  to older channels' links the first time a Space admin opens the Space). The Space's links are
  readable by anyone in the Space, so the bot can tell voice from text *before* joining. At
  startup, on every 60s reconciliation, and as soon as a voice link arrives, it walks into every
  voice channel of every Space it serves (`servedVoiceChannelIds` in `src/tenancy.ts`), through
  the same `joinIfServed` gate. It never joins text channels: it only answers "may this person
  join the call?", and being in a text channel would hand every message to whoever runs the voice
  server. An old invite-only voice channel can't be walked into; the client-side invite below
  still covers it.
- **The bot joins on demand**, not only off a sync event — `checkMembership` gets into a room
  before answering for it, so "create a channel, click it, talk" works on the first attempt
  instead of waiting for the reconciliation pass (which still runs, every 60s, as a backstop).
  Every one of those three paths goes through the same `joinIfServed` gate; an invite it won't
  act on is left pending rather than rejected, since a channel's `m.space.child` link is written
  a round trip *after* its creation invite, and a refusal in that window is only temporary.
- **Lazy-loaded members no longer read as non-members.** The bot syncs with
  `lazyLoadMembers: true`, so its local room state only carries members the homeserver
  considered relevant to *it* — an ordinary member of a busy room can legitimately be missing.
  On a local miss, `checkMembership` now falls back to a direct
  `GET /rooms/{roomId}/state/m.room.member/{userId}` (plus `m.room.power_levels`) rather than
  concluding "not a member," which is what used to lock real members out of voice at random.

## Power level → grant mapping

| Condition | Grants |
|---|---|
| Bot can't get into the room | `409 voice_bot_not_in_room` — the client invites it and retries |
| Room isn't a channel in a space this deployment serves | Rejected (`403 room_not_served`) — see "Which rooms a deployment serves" |
| Not a room member | Rejected (`403 not_a_member`) before any token is minted |
| Member, power level `< VOICE_MODERATOR_POWER_LEVEL` (default `50`) | `roomJoin, canPublish, canSubscribe, canPublishData` |
| Member, power level `>= VOICE_MODERATOR_POWER_LEVEL` | Above, plus `roomAdmin` (mute-others, etc.) |

`VOICE_MODERATOR_POWER_LEVEL` is configurable via env on the token server
(`services/token-server/src/grants.ts`).

## LiveKit room lifecycle

Rooms are created on first join and destroyed when empty (LiveKit's own default behavior — the
token server never explicitly creates or tears down a room). Who's currently in a voice
channel is queried live from LiveKit on demand (`RoomServiceClient.listParticipants`,
`GET /api/livekit/rooms/participants?roomIds=...`) rather than cached from webhooks — LiveKit
doesn't send a webhook when a track's mute state changes after publish (only on publish/
unpublish), so a cache built from webhooks alone couldn't report current mic-mute state anyway;
asking LiveKit "who's here and what's their state right now" is both simpler and always
current. This powers the channel list's per-voice-channel occupant list (avatar, name,
mic-muted/deafened icons — `src/features/channels/ChannelList.tsx`'s `VoiceChannelOccupants`,
fed by `src/matrix/hooks/useVoiceChannelParticipants.ts`). Deafened state isn't something
LiveKit's server can see (it's local playback muting, not anything published) — the client
broadcasts its own via `localParticipant.setAttributes({ deafened: 'true' | 'false' })`
(`VoiceChannelPanel.tsx`'s `toggleDeafen`), which `listParticipants` also picks up as ordinary
participant attributes.

## Frontend pieces

- `src/features/voice/VoiceCallSession.tsx` — owns the actual voice call, mounted once at the
  `AppShell` level (above `ChannelList`/`MainPane`), not tied to which channel is currently
  selected/viewed — so switching to a text channel to keep chatting doesn't disconnect you
  (Discord's model). Auto-joins on selecting a voice channel (or switching between two), and
  is the sole owner of `<LiveKitRoom>` and the active-call React context (`voiceCallContext.ts`)
  that `MainPane`'s call UI and the channel list's connected-call bar both read from. Its
  auto-join is keyed on the room **and** the Space's voice server, not the room alone: that
  config is read out of room state, which on a cold sync can still be loading when the channel
  is first selected, and keying on the room alone left the call stuck on "No voice server is
  configured" forever once it arrived.
- `src/matrix/hooks/useVoiceConnection.ts` — owns the token fetch/lifecycle only
  (`idle → connecting → preparing → ready | error`); does not touch the actual RTC connection.
  Also owns getting the service bot into the room, which is a precondition of the token fetch
  rather than separate setup — see "Service bot membership" above.
- `src/matrix/voiceBot.ts` — the service bot's presence check, invite, and
  `GET /api/livekit/config` lookup. Pure functions over a `Room` + `VoiceServerConfig`, so the
  "is it there / can I fix that / did the fix land" logic is unit-testable without a call. Used
  for two rooms: the Space (from `SpaceGeneralSettings`, which is what makes the token server
  serve it at all) and an individual voice channel.
- `src/features/voice/VoiceChannelPanel.tsx` — the call UI for a given room: renders the join
  prompt/connecting/error states, or (once the active call for *this* room is `ready`) an
  audio-first participant grid (avatar + speaking-ring outline + mic-muted/deafened badges) and
  the control bar (mic mute, push-to-talk + its rebindable key, deafen, camera, screen share,
  Watch Together, leave). Deafening also mutes your own mic (Discord's behavior); un-deafening
  does not auto-unmute. Doesn't own the LiveKit connection itself — see VoiceCallSession above.
  A failed call offers a real retry (`VoiceCallContextValue.retry`) rather than re-selecting the
  already-selected channel, which set an atom to the value it already held and did nothing.
- `src/features/voice/usePushToTalk.ts` — push-to-talk and its key binding, both per-device
  (localStorage). The key is rebindable from the control bar; turning push-to-talk off hands the
  mic back rather than leaving it muted under an unmuted-looking button.
- `src/features/voice/voiceSounds.ts` / `useParticipantSounds.ts` — ported verbatim from
  cinny-voice: Web Audio join/leave/connect/disconnect tones, no external audio files.
- `src/features/voice/voiceChannelRoomOptions.ts` — H.264-preferred screen share, 8 Mbps/60fps
  encoding defaults, and a viewer-side jitter-buffer + keyframe-request (PLI) enhancement for
  smoother remote screen-share playback. Ported from cinny-voice, but the receiver-lookup path
  was rewritten for this project's pinned `livekit-client` version: that copy of the function
  expected `room.engine.subscriber.getReceivers()`, which doesn't exist here — this version goes
  through `room.engine.pcManager.subscriber.getTransceivers()` and reads `.receiver` off each
  transceiver instead, which is the same underlying `RTCRtpReceiver` set. Re-check this path if
  `livekit-client` is ever upgraded across a major version.
- `src/features/voice/screenShareKeyframeRequest.worker.ts` — the PLI-pacing Web Worker,
  ported verbatim. Its `addEventListener('rtctransform', ...)` types
  (`RTCTransformEvent`/`RTCRtpScriptTransformer`) aren't in TypeScript's bundled DOM lib
  (experimental, worker-scope-only Insertable Streams API) — declared locally as ambient
  interfaces in that file rather than a shared `.d.ts`.

## Deferred (not in this pass)

The live "who's in this voice channel" indicator in the channel list *is* now built (see
"LiveKit room lifecycle" above), and so are three more items previously listed here: a
per-participant "volume for me" slider and a 3-bar connection-quality indicator in the call
panel (`VoiceChannelPanel.tsx`'s `ParticipantRow`), and a screen-share pop-out window
(`useScreenSharePopout.ts` — re-attaches the same `MediaStreamTrack` to a `<video>` in a real
second browser window via `window.open()`, closing it automatically if the share ends or the
component unmounts). The volume slider is `RemoteParticipant.setVolume()`, purely local (it
doesn't touch what anyone else hears); the quality bars come from
`@livekit/components-react`'s own `useConnectionQualityIndicator` hook, not hand-rolled. None of
these three were verified against a live call in this pass (no LiveKit/token-server deployment
was reachable from the dev environment they were built in) — typechecked and written against
the documented LiveKit APIs, but treat as unverified until actually exercised in a real call.

Adaptive-bitrate tiering is still deliberately not done: this app's screen share already runs a
fixed, deliberately high H.264 bitrate (`voiceChannelRoomOptions.ts`, tuned for 1080p60 on a
non-transcoding server) rather than LiveKit's adaptive/simulcast path, and flipping that on
blind — without a live call to check it doesn't regress the existing tuning — isn't a change to
make without being able to verify it. WebRTC-policy-specific error messaging (privacy-browser
UDP-blocking guidance) remains deferred too, unrelated to this pass.
