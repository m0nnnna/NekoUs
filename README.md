# NekoUs

A from-scratch, Discord-shaped frontend for Matrix — Spaces as servers, rooms as channels, voice
channels backed by per-Space LiveKit servers with Matrix-membership-gated auth. NekoUs is a
**client only**; Matrix (Synapse, Continuwuity, or any spec-compliant homeserver) is the backend.

See [`docs/theming.md`](docs/theming.md) for the CSS theming contract, [`docs/voice-architecture.md`](docs/voice-architecture.md)
for how voice/video calls work under the hood, [`docs/push-notifications.md`](docs/push-notifications.md)
for background push, and [`docs/deployment.md`](docs/deployment.md) for a full self-hosting guide.

## Features

### Messaging
- Real-time timeline with inline images, file/attachment uploads (video/audio players, download
  cards for everything else), and transparent E2EE for encrypted rooms.
- Markdown formatting (bold/italic/code/strikethrough), Discord-style `||spoilers||`, and fenced
  code blocks with syntax highlighting (Prism.js).
- `@mention` autocomplete with real push-rule-triggering mentions, plus `@room` mass-mentions
  (permission-gated, same power level as kick/ban).
- Reactions, threads, in-place message editing with full edit history, quote-reply, message
  forwarding, and private cross-room saved messages/bookmarks.
- Pinned messages, read receipts, typing indicators, and unread/mention badges that clear
  correctly server-side.
- Server-side message search (per-room or global) with jump-to-and-highlight on the result.
- A dedicated Mention Inbox — every real `@mention` gets logged to a private list you can jump
  back to later, independent of scrolling back through a busy channel.
- Slash commands: `/me`, `/shrug`, `/nick`, `/topic`, `/invite`, `/kick`, `/ban`, `/unban`, `/leave`.
- Custom animated emotes and stickers via MSC2545 image packs (interoperable with Element/cinny/
  FluffyChat) — per-channel or space-wide, managed from a permission-gated picker.
- Rich link/URL previews (server-side OpenGraph unfurling, no client-side scraping).
- Drag-and-drop and paste-to-upload for attachments.
- Discord-style channel categories (collapsible, reorderable) inside a Space.

### Voice & Video
- Voice channels as a distinct channel type — join instantly from the channel list, with a live
  occupant list (avatar, name, mute/deafen state) shown inline.
- Calls are owned independently of whatever's selected in the main pane, so switching to a text
  channel doesn't hang up; a persistent call bar lets you get back to it from anywhere.
- One LiveKit deployment per Space, shared by every voice channel in it. Joining is gated through
  a Matrix-membership-checked token server (`services/token-server/`) — a Matrix OpenID token
  proves identity, a service-bot account confirms room membership, only then is a scoped LiveKit
  token minted.
- Audio-first participant grid (speaking indicator, mute/deafen badges, per-participant local
  volume control, connection-quality indicator), webcam video, and screen sharing (with audio)
  with a pop-out window and H.264-preferred encoding for GPU-friendly decode.
- Push-to-talk (hold-to-talk on a configurable key).
- **Watch Together** — start a shared YouTube or direct media link for the whole call, playing in
  the same slot screen share uses. Only small control messages (play/pause/seek/stop) cross
  LiveKit's data channel; every participant's browser plays the source independently, kept in
  sync. Anyone can control playback, reflected live for everyone else.

### Spaces, Channels & Servers
- Create and manage Spaces (servers) and channels, with a permission-gated Settings modal:
  rename/topic/avatar, member management (invite, promote/demote roles, kick/ban/unban — all
  backed by real Matrix power-level checks), a Categories tab, and a Space-wide moderation audit
  log (invites, kicks, bans, power-level and topic changes, deletions).
- Per-server nicknames — a display-name override scoped to one Space, layered on top of Matrix's
  per-room `m.room.member` override.
- Add an existing room as a channel, or discover and join public Spaces/rooms via a directory
  browser (search + one-click join). Channels you haven't joined yet but belong to a Space you're
  in show up under "More Channels" with a one-click join.
- Full invite flow — accept or decline pending invites (Space, channel, or DM) from a dedicated
  Invites list.

### Security & Encryption
- End-to-end encryption via `matrix-js-sdk`'s Rust crypto engine, with cross-signing, secret
  storage, and key backup set up automatically at registration.
- Recovery-key restore flow for new sessions that can't yet decrypt history (standard recovery
  key or a custom passphrase).
- Interactive emoji (SAS) device verification, both for your own devices and for verifying
  another user's identity from their profile. QR-code verification isn't offered.
- Session/device management — see and sign out any device from Account Settings.

### Notifications
- Desktop notifications, gated by the same push-rule evaluation the server uses.
- Background push notifications when no tab is open, via a dedicated push gateway
  (`services/push-gateway/`) that bridges Matrix's Push Gateway API to real Web Push (VAPID) —
  see [`docs/push-notifications.md`](docs/push-notifications.md).

### Customization & Theming
- Full custom theming — Account Settings → Appearance is a raw-CSS editor (paste or load a
  `.css` file), applied instantly. Every color/spacing/radius/font value in the app routes through
  a `--nu-*` token (`src/styles/tokens.css`), so a theme only needs to override tokens, not hunt
  down individual components.
- Ships with two built-in looks: a glossy "Y2K Chatroom" default and a black-and-hot-pink "Lola"
  preset.
- Expanded profiles — bio, banner, and animated (GIF/WebP) avatars, on top of Matrix's bare
  `displayname`/`avatar_url`, via MSC4133 extended profiles.
- Custom status (Online/Away/Invisible + a free-text status message), visible to others.
- Responsive layout — below 900px width the shell becomes a one-screen-at-a-time mobile flow.

### Known scope limits
- Room join rules: private/public only (no restricted/knock rules, no room-version selection).
- Role/permission management is per-Space only — Matrix doesn't cascade a Space's power levels
  down to its channels.
- Only emoji-SAS device verification is offered (no QR codes).
- The Space-wide audit log is a rolling recent log derived from locally-loaded timeline events,
  not a complete historical archive.

## Self-hosting

`deploy/docker-compose.yml` builds and runs NekoUs's own services: LiveKit, the token server, the
push gateway, and the web client (served by nginx). Matrix itself isn't part of this stack by
default — point it at any homeserver you already run — **or** let the guided installer provision
one for you too (a lightweight, federation-capable [Continuwuity](https://continuwuity.org/)
homeserver, including automatic account creation), plus optional TURN relay hardening to hide the
server's IP. See [`docs/deployment.md`](docs/deployment.md) for the full walkthrough either way.

Quick version, if you already know your way around this:

```bash
cp .env.example .env   # fill in LiveKit keys, HOST_IP, the token server's bot credentials, VAPID keys
docker compose -f deploy/docker-compose.yml --env-file .env up --build
```

Or run the guided installer on a fresh VPS instead of doing it by hand:

```bash
sudo bash deploy/setup.sh
```

It asks a handful of questions (domain, whether to bring your own homeserver or have it provision
one, whether to enable TURN hardening), then handles Docker/certbot/nginx installation, secret
generation, TLS certificates, and bringing the stack up.

After the stack is up, each Space still needs its LiveKit URL and token endpoint set once, in-app
under Space Settings, and each account needs its push gateway URL set once under Account
Settings — see [`docs/voice-architecture.md`](docs/voice-architecture.md)'s "State events" section
for why voice config in particular is per-Space rather than baked into `.env`.

## Development

```bash
cd apps/web
npm install
npm run start
```

Then point the app at any Matrix homeserver you have an account on (defaults to `matrix.org` in
the login form).

**If the repo lives on a network share whose ACLs deny Execute permission**, npm's native
binaries (esbuild, etc.) will fail with "Access is denied." Work around it by running
`npm install`/`npm run build`/`npm run start` from a local disk instead — keep the network share
as your canonical/edited copy and sync to a local mirror before each run:

```bash
robocopy \\your\network\share\apps\web C:\local\mirror\apps\web /MIR /XD node_modules dist
cd C:\local\mirror\apps\web
npm install && npm run start
```

`deploy/docker-compose.dev.yml` is an alternative that bind-mounts `apps/web` into a container and
keeps `node_modules` in a Docker volume — works well on a normal local disk, but Docker Desktop's
bind-mount support for some network-share configurations can be unreliable; if you hit stale or
empty directory listings inside the container, fall back to the local-mirror approach above.

## Testing

`npm test` (Vitest, `apps/web/vitest.config.ts`) runs the unit suite — pure logic that doesn't
need a live Matrix client or homeserver: message formatting/rendering, permissions, direct
messages, replies, room emotes/nicknames/directory/audit-log helpers, and the Watch Together sync
hook (via a faked LiveKit room). Components wired directly to a live `MatrixClient` aren't covered
by this suite; run the app against a real homeserver to exercise those paths.

## Production deployment

`deploy/docker-compose.yml` builds and runs all of NekoUs's own services together. Both
Dockerfiles use a repo-root build context so they can `COPY` a single package into an otherwise-
empty image without pulling in the other package's `node_modules` (see `.dockerignore`).

Every service's published port is bound to `127.0.0.1` except LiveKit's real-time-media ports
(`7881/tcp`, `7882/udp`, and — with TURN hardening enabled — `5349/tcp`/`3478/udp`), which can't be
proxied through nginx and need to reach the internet directly. nginx is meant to be the only thing
actually facing the internet, terminating TLS and proxying to `127.0.0.1:<port>` for everything
else — see `deploy/nginx/` for reverse-proxy examples.

See [`docs/deployment.md`](docs/deployment.md) for the complete guide, including DNS, TLS, the
guided installer, and the split edge-proxy/origin topology for running nginx on a separate box
from the app services.
