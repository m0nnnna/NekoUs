# Background push notifications

Single source of truth for how Purrlor delivers a notification when no tab is open: the account
data event, the push gateway's two roles, and what's actually been verified versus what needs a
real device to confirm. Read this before touching anything under
`apps/web/src/matrix/push.ts`, `apps/web/src/app/BackgroundPushSettings.tsx`,
`apps/web/public/sw.js`, or `services/push-gateway/`.

## Why a whole extra service

Matrix's own push model (the [Push Gateway API](https://spec.matrix.org/latest/push-gateway-api/))
assumes the client platform already has a push transport the *homeserver* can hand off to — APNs
for iOS, FCM for Android — and a "push gateway" translates the homeserver's generic notify call
into that platform's specific delivery call. The web doesn't have a homeserver-facing equivalent
of its own: browsers only support the standard [Web Push protocol](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
which needs VAPID-signed requests sent directly to whichever push service the browser itself
picked (`https://fcm.googleapis.com/...` for Chrome, `https://updates.push.services.mozilla.com/...`
for Firefox, etc.) — a homeserver has no reason to know how to do that. `services/push-gateway` is
that missing translator: it speaks the Push Gateway API to the homeserver on one side, and real
Web Push to whatever browser subscribed on the other.

## Model

Account-wide, not per-Space (unlike voice, which is genuinely tied to a community) — a person
wants their notifications wherever they are, so the gateway URL is stored as the user's own
Matrix account data, and enabling it is a **per-device** action (a browser's Web Push subscription
is inherently device-local; there's nothing to inherit).

## Account data: `xyz.nekous.push_gateway`

```json
{ "url": "https://push.example.com" }
```

- Read via `readPushGatewayUrl(mx)`, written via `setPushGatewayUrl(mx, url)` (`matrix/push.ts`).
- Set from Account Settings → Account, in the same input that triggers enabling push
  (`BackgroundPushSettings.tsx`) — there's no separate "save" step for just the URL.

## The enable flow (`enableBackgroundPush`, `matrix/push.ts`)

1. `Notification.requestPermission()` — must run from a real click; browsers reject/ignore it
   otherwise. Web Push delivery is impossible without this regardless of anything below.
2. Register `/sw.js` (root-scoped service worker, plain static file in `apps/web/public/` — no
   build step, no asset caching, it only exists for the `push`/`notificationclick` handlers).
3. Fetch the gateway's current VAPID public key (`GET /vapid-public-key`) rather than hardcoding
   it into the frontend build — regenerating the key pair needs no rebuild.
4. `pushManager.subscribe()` with that key → a real `PushSubscription` (an endpoint URL specific
   to this browser + encryption keys).
5. Hand that subscription to the gateway (`POST /subscribe`, keyed by a random pushkey this
   client generates and keeps in `localStorage` — `xyz.nekous.webpush` app_id).
6. `mx.setPusher({ kind: 'http', pushkey, data: { url: '<gateway>/_matrix/push/v1/notify' }, ... })`
   — this is what actually tells the homeserver to start calling the gateway.

Disabling reverses all of it: `removePusher`, `DELETE /subscribe/:pushkey`, then
`subscription.unsubscribe()` locally.

## The gateway (`services/push-gateway`)

Two roles, both in `src/server.ts`:

- **Subscription store** (`POST /subscribe`, `DELETE /subscribe/:pushkey`) — an in-memory
  `pushkey -> PushSubscription` map (`src/subscriptions.ts`), same "no persistent store, single
  process" posture as the token server. Lost on restart; a client just re-subscribes and
  re-registers its pusher next time it loads, same as any browser push subscription surviving a
  browser restart.
- **`POST /_matrix/push/v1/notify`** — the actual Push Gateway API endpoint the homeserver calls.
  For each device in the request, looks up its stored subscription and sends a real Web Push
  message (the `web-push` npm package, VAPID-signed) built from the notification's sender/room/
  content. Reports back `{ rejected: [...pushkeys] }` for any the push service confirms are
  permanently gone (HTTP 404/410 — uninstalled browser, cleared storage) so the homeserver stops
  trying them; a transient delivery failure is logged and left alone to retry on the next event.

**Encrypted rooms**: the homeserver can't decrypt an `m.room.message` any more than we can, so
`content.body` on an encrypted room's notification is useless ciphertext, not a preview — the
gateway falls back to a generic "Sent a message" body rather than showing garbage.

## Deployment

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — generate a pair with
  `npx web-push generate-vapid-keys` (from `services/push-gateway`, once its dependencies are
  installed); see `.env.example`. A fresh pair per deployment, never shared.
- The gateway's own public URL is **not** an env var for the web app — see "Account data" above,
  it's configured in-app.
- `deploy/docker-compose.yml` builds and runs it alongside `livekit`/`token-server`/`web`.

## Verified this session / not yet verified

Verified against a real local stack (`docker compose -f deploy/docker-compose.yml --env-file .env
up -d push-gateway`, run from the `C:\dev\nekous` mirror — same `N:\` bind-mount limitation as
LiveKit, see the main README): `/health`, `/vapid-public-key`, `POST /subscribe` (204), and
`POST /_matrix/push/v1/notify` correctly reporting an unknown pushkey as `rejected` and correctly
attempting a real Web Push send (verified via container logs) for a known one.

**Not verified end-to-end**: this automated session's browser can't click through a native
`Notification.requestPermission()` prompt (same hard limitation as the video-call camera
permission prompt — nothing here can drive a real OS/browser permission dialog), so the actual
subscribe → receive → click-to-open path needs a human. Separately, even with a human: the
homeserver (`chat.frennet.xyz` in this dev setup) needs to be able to reach the gateway's
`/_matrix/push/v1/notify` endpoint over the public internet to ever call it for real — a
`localhost` gateway works for everything *this* client-side testing needed (subscribing, and
manually POSTing a notify to simulate what the homeserver would send), but never receives a real
homeserver-initiated call unless it's actually deployed somewhere reachable.
