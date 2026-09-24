# NekoUs

A from-scratch, Discord-shaped frontend for Matrix — Spaces as servers, rooms as channels, voice
channels backed by per-Space LiveKit servers with Matrix-membership-gated auth. NekoUs is a
**client only**; Matrix (Synapse, Continuwuity, or any spec-compliant homeserver) is the backend.

See [`docs/theming.md`](docs/theming.md) for the CSS theming contract, [`docs/voice-architecture.md`](docs/voice-architecture.md)
for how voice/video calls work under the hood, [`docs/posts.md`](docs/posts.md) for the per-member
post feeds, [`docs/push-notifications.md`](docs/push-notifications.md) for background push, and
[`docs/deployment.md`](docs/deployment.md) for a full self-hosting guide.

## Using NekoUs

### Signing in
Open the app and enter a **homeserver** (defaults to `matrix.org`, but works with any Matrix
homeserver — including a self-hosted one) plus a username/password to log in, or use "Register"
to create a new account on that homeserver. A brand-new session may show a recovery prompt to
unlock past encrypted history — enter the account's recovery key/passphrase, verify from another
already-signed-in device via emoji comparison, or skip it for now and unlock it later from Account
Settings.

Just want to look around first? Click **"Just looking? Take a tour with sample data"** on the login
screen (or add `?demo` to the URL) — see [Demo mode](#demo-mode).

### Layout
- **Server rail** (far left) — a column of Space icons, like Discord servers. The pinned icon at
  the top is Home (Direct Messages and any room not organized under a Space); below it are your
  joined Spaces, then Mentions, Invites, and Discover.
- **Channel list** — the selected Space's channels, grouped into categories, with voice channels
  shown separately from text channels.
- **Main pane** — the selected channel's timeline (or a voice channel's call panel).
- **Member list** (far right, collapsible on mobile) — who's in the current channel/Space.
- Below ~900px wide, this collapses into one screen at a time instead of four columns side by side.

### Joining or creating a Space
- **Have an invite?** Click the ✉️ Invites icon in the server rail to accept or decline it.
- **Have an invite link?** Just open it — it joins you straight in (creating an account first if
  you don't have one yet).
- **Don't have either?** Click 🧭 Discover to search public Spaces and join with one click.
- **Starting your own?** Click the **+** at the bottom of the server rail to create a new Space,
  then use its channel list header's **+** to add channels to it.

### Messaging
Type in the composer and send with Enter (Shift+Enter for a newline). Supports Markdown
(`**bold**`, `*italic*`, `` `code` ``, `~~strikethrough~~`), `||spoilers||`, fenced code blocks
with syntax highlighting, `@mentions` (autocompleted), and slash commands (`/me`, `/nick`,
`/topic`, `/invite`, `/kick`, `/ban`, `/unban`, `/leave`, `/shrug`). Drag a file in or paste an
image to upload it. Hover a message for reactions, reply, edit, forward, pin, and save-for-later;
right-click (or the "..." menu) for more. The 🔍 icon searches the current channel or everywhere;
the @ icon in the server rail opens your Mention Inbox — everywhere you were actually @mentioned,
so you don't have to scroll back to find it.

### Voice & video
Click a voice channel to join instantly — no separate "call" step. The call bar stays active even
if you switch to a different text channel, so you can keep chatting elsewhere without hanging up;
click it to jump back. Controls: mute/deafen, push-to-talk (hold a key instead of toggling —
click the key name next to it to rebind, default Right Ctrl), webcam, and screen share (with
audio, plus a pop-out window). Voice channels set themselves up: as long as the Space has a
voice server configured, a new voice channel is joinable the moment it exists, with no
per-channel setup step. The 📺 button starts
**Watch Together** — paste a YouTube or direct media link and everyone in the call watches in
sync; anyone can play/pause/seek and it's reflected for the whole call.

### Notifications
Desktop notifications work as soon as your browser grants permission. For notifications when no
tab is open, set a push gateway URL once under Account Settings → Notifications (see
[`docs/push-notifications.md`](docs/push-notifications.md) if you're self-hosting one).

### Making it yours
Account Settings → Appearance lets you set a status (Online/Away/Invisible + a message), add a
bio/banner/animated avatar, and fully re-theme the app by pasting or loading a `.css` file — pick
between the built-in "Y2K Chatroom" and "Lola" looks, or write your own. Space Settings lets you
set a nickname scoped to just that Space, independent of your global display name.

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
- That service bot manages its own membership: the token server publishes its account ID, Space
  Settings picks it up from the token endpoint, and voice channels invite it themselves — at
  creation for new ones, on first join for older ones. A Matrix invite doesn't cascade from a
  Space to its channels, so without this every voice channel needed a manual invite of an
  account whose ID wasn't shown anywhere. See `docs/voice-architecture.md`.
- Audio-first participant grid (speaking indicator, mute/deafen badges, per-participant local
  volume control, connection-quality indicator), webcam video, and screen sharing (with audio)
  with a pop-out window and H.264-preferred encoding for GPU-friendly decode.
- Push-to-talk (hold-to-talk, rebindable from the call controls; defaults to Right Ctrl).
- **Watch Together** — start a shared YouTube or direct media link for the whole call, playing in
  the same slot screen share uses. Only small control messages (play/pause/seek/stop) cross
  LiveKit's data channel; every participant's browser plays the source independently, kept in
  sync. Anyone can control playback, reflected live for everyone else.

### Posts
- Every member gets a **feed** inside a Space — post under your own name, readable by everyone in
  the hub. The **Posts** view at the top of the channel list merges the whole hub's timeline;
  a Yours tab shows only your own.
- Posts share the message pipeline, so inline Markdown and custom emotes work the same way they
  do in a channel. Posts deliberately don't notify — they're a custom event type no push rule
  matches — so following the whole hub doesn't mean being pinged by it.
- A post is either public or **only you**. Because Matrix has no per-event visibility, that isn't
  a flag: a public post is an event in your feed room, while a private one lives in your account
  data and was never in a room at all. Publish it later, or take a public post back the same way.
  See [`docs/posts.md`](docs/posts.md).
- Each feed is its own Matrix room, restricted to the Space and world-readable, discovered through
  a key on the author's own membership of the Space — so it needs no admin permission to start
  one, and nothing pollutes the channel list.

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
- Shareable invite links for Spaces (Settings → Invite Link) — anyone with the link joins
  instantly, without listing the Space in the public directory. Turning the link off invalidates
  every copy of it at once.

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

## Demo mode

Open the app with `?demo` (`http://localhost:8080/?demo`), or click "Just looking? Take a tour
with sample data" on the login screen, to run the entire UI against a fabricated in-memory Matrix
world — no homeserver, no LiveKit, no network at all. It's for reviewing a theme, checking a
layout change, or showing someone what NekoUs is without deploying anything first.

What's in it: two Spaces (one with voice fully configured, one with none), categorized text and
voice channels, a seeded conversation with Markdown/code blocks/spoilers/reactions/mentions, DMs
and a group chat, and members at a range of power levels. Sending a message, saving Space
Settings, and inviting someone all really do update the world — it's built on genuine
matrix-js-sdk `Room` and `MatrixEvent` objects, so the app's own read paths run unmodified rather
than against a second, hand-written imitation of them.

Voice deliberately stops one step short of connecting. The fake token server implements the real
endpoint shapes, so selecting the "AFK" channel genuinely exercises the service-bot self-heal —
invite, `voice_bot_not_in_room`, "Setting up voice for this channel…", recovery once the bot
joins — but it never mints a LiveKit token, because there's no LiveKit to connect to. The in-call
UI (participant grid, control bar, Watch Together) therefore isn't covered by demo mode and still
needs a real deployment.

Demo mode is entered only from the URL, never persisted, and never touches a stored session; a
banner stays on screen throughout so demo data can't be mistaken for the real thing. It lives in
`apps/web/src/demo/` and is pulled in through a dynamic `import()`, so it's a separate ~13 KB
chunk that anyone running against a real homeserver never downloads.

## Testing

`npm test` (Vitest, `apps/web/vitest.config.ts`) runs the unit suite — pure logic that doesn't
need a live Matrix client or homeserver: message formatting/rendering, permissions, direct
messages, replies, room emotes/nicknames/directory/audit-log helpers, and the Watch Together sync
hook (via a faked LiveKit room).

Components wired directly to a `MatrixClient` are covered through demo mode's fake client
(`src/demo/*.test.*`): the real `ChannelList` and `MessageTimeline` are rendered against the
seeded world, and the voice service-bot self-heal is driven end to end through the unmodified
`useVoiceConnection` against the fake token server's real HTTP shapes. What still isn't covered
anywhere is a live homeserver (real sync, E2EE, device verification) and a live LiveKit call —
run the app against a real deployment to exercise those.

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
