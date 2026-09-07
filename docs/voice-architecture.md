# Voice architecture

Single source of truth for how NekoUs voice channels work: the two custom state events, the
LiveKit room-name algorithm, the token-server auth flow, and the power-level → grant mapping.
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
{ "url": "wss://livekit.example.com", "tokenEndpoint": "https://example.com/api/livekit/token" }
```

- Both fields are required together — the LiveKit WS URL and the token-server HTTP endpoint are
  independent pieces of information; one isn't derivable from the other. `setVoiceServerConfig`
  refuses to write one without the other (enforced in the settings UI, not the SDK call itself).
- Set via `SpaceGeneralSettings.tsx`, gated the same way as name/topic/avatar edits
  (`canSendStateEvent`).
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
so `btoa` and UTF-8 `Buffer` encoding produce byte-identical output — **if that assumption ever
changes, both copies need to change together.**

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
   - Simplification worth knowing (`services/token-server/src/openid.ts`): this hits
     `https://{matrix_server_name}/...` directly rather than implementing full federation server
     discovery (`.well-known/matrix/server` delegation, SRV records, the `:8448` fallback).
     Fine for a standard self-hosted setup reverse-proxied on 443 (this project's own deployment
     included); won't work for a homeserver that delegates federation to a different host/port
     without a matching direct HTTPS path at its own `server_name`.
4. Token server checks the validated user is actually a member of `room_id`, via a persistent
   Matrix service-bot account kept joined to every gated room (`src/membership.ts`) — mirrors
   `element-hq/lk-jwt-service`'s approach instead of doing federation state resolution itself.
   Not a member → `403`.
5. Token server mints a LiveKit `AccessToken` scoped to `livekitRoomName(room_id)`, with grants
   from the member's power level (see below), and returns `{ token, roomName }`.
6. Client renders `<LiveKitRoom serverUrl={config.url} token={token} connect />`
   (`@livekit/components-react`), which owns the actual WebRTC connection lifecycle from there.

## Power level → grant mapping

| Condition | Grants |
|---|---|
| Not a room member | Rejected (`403`) before any token is minted |
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
  that `MainPane`'s call UI and the channel list's connected-call bar both read from.
- `src/matrix/hooks/useVoiceConnection.ts` — owns the token fetch/lifecycle only
  (`idle → connecting → ready | error`); does not touch the actual RTC connection.
- `src/features/voice/VoiceChannelPanel.tsx` — the call UI for a given room: renders the join
  prompt/connecting/error states, or (once the active call for *this* room is `ready`) an
  audio-first participant grid (avatar + speaking-ring outline + mic-muted/deafened badges) and
  a four-button control bar (mic mute, deafen, screen share, leave). Deafening also mutes your
  own mic (Discord's behavior); un-deafening does not auto-unmute. Doesn't own the LiveKit
  connection itself — see VoiceCallSession above.
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
