# Deploying your own NekoUs server

A guided, start-to-finish walkthrough for standing up a NekoUs deployment on a fresh VPS: DNS,
TLS, the four services in `deploy/docker-compose.yml`, and the handful of settings that live
inside the app itself rather than in `.env`. There's also `deploy/setup.sh`, a script that
automates most of the mechanical steps below — see "The guided script" near the end if you'd
rather not run each command by hand. Reading this guide first is still worth it even if you use
the script: it explains *why* each step exists, which the script doesn't.

## Scope — what this is (and isn't)

NekoUs is a **Matrix client**, not a homeserver — but `deploy/setup.sh` can optionally provision
one for you too. There are two ways to go:

- **Option A — bring your own homeserver.** This is what the rest of this guide (Steps 1–10)
  walks through: you already have a Matrix homeserver (Synapse, Dendrite, Conduit, whatever —
  anything with a working Client-Server API) and just want NekoUs's own services stood up
  alongside it. If you don't have a homeserver yet and want to run one yourself long-term,
  [Synapse's own install docs](https://element-hq.github.io/synapse/latest/setup/installation.html)
  are the standard starting point — set that up first, then come back here.
- **Option B — let the script provision one too.** If you don't have a homeserver and don't want
  to set one up by hand, `deploy/setup.sh` can spin up
  [Continuwuity](https://continuwuity.org/) (a lightweight, spec-compliant, federation-capable
  Rust homeserver — no separate database service to run) as part of the same guided setup,
  including **automatically creating both your own account and the token server's bot account**
  via the registration API — no manual Matrix account creation, no copying access tokens by hand.
  This needs two things Option A doesn't: one extra DNS record (the bare apex domain, for
  `.well-known` federation delegation) and one extra open port (**8448/tcp**, federation). The
  script asks which option you want right after the initial domain prompts and handles either
  path from there — everything below Step 4 in this guide is unaffected either way, since the
  token server just takes a homeserver URL + bot credentials and doesn't care which homeserver
  software is actually behind them.

Either way, this guide assumes you have:

- **A domain name you control the DNS for.**
- **A VPS** (or any always-on Linux box with a public IP) to run NekoUs's own services on (and,
  with Option B, the new homeserver too). This can be the same machine as an existing homeserver
  or a different one — they don't need to be co-located, they just both need to be reachable over
  HTTPS.

What you're deploying on that VPS is four small services, all defined in
`deploy/docker-compose.yml`:

| Service        | What it does                                             | Talks to the internet as |
|----------------|-----------------------------------------------------------|---------------------------|
| `web`          | The NekoUs client itself (the thing people open in a browser) | `app.YOUR_DOMAIN` |
| `livekit`      | Voice/video call media server                              | `livekit.YOUR_DOMAIN` |
| `token-server` | Issues LiveKit call tokens, gated by Matrix room membership/power level | `token.YOUR_DOMAIN` |
| `push-gateway` | Turns Matrix push notifications into real Web Push, for notifications when no tab is open | `push.YOUR_DOMAIN` |

None of these four subdomains should collide with your homeserver's own domain (often
`matrix.YOUR_DOMAIN` or similar) — they're separate services. If you skip voice/video and
background push entirely, you only need `app.YOUR_DOMAIN` and can drop `livekit`, `token-server`,
and `push-gateway` from the compose file and the nginx config below.

## Prerequisites checklist

- [ ] A VPS running Ubuntu 22.04/24.04 (or Debian — the commands below are `apt`-based; adapt for
      another distro). 1 vCPU / 1-2 GB RAM is plenty unless you expect a lot of concurrent voice
      calls.
- [ ] Root or sudo access on it.
- [ ] A domain, with the ability to add DNS records.
- [ ] **Option A only:** your existing homeserver's URL and an account on it you can use to create
      a dedicated bot account (see Step 4). **Option B only:** nothing extra here — the script
      creates both the bot account and your own account for you.
- [ ] Ports **80/tcp**, **443/tcp**, **7881/tcp**, and **7882/udp** reachable from the internet
      on the VPS (check your provider's firewall/security-group settings, not just the OS
      firewall — cloud providers often filter inbound traffic separately). The first two are
      normal HTTPS; the last two are LiveKit's WebRTC media ports and can't be proxied through
      nginx like everything else — real-time media has to reach the box directly. **Option B
      also needs 8448/tcp** (Matrix federation).

## Step 1 — DNS

Point four A (or AAAA) records at your VPS's public IP:

```
app.YOUR_DOMAIN      ->  <VPS IP>
livekit.YOUR_DOMAIN   ->  <VPS IP>
token.YOUR_DOMAIN     ->  <VPS IP>
push.YOUR_DOMAIN      ->  <VPS IP>
```

**Option B (bundled homeserver) needs two more** — the bare apex domain (for `.well-known`
federation delegation) and a `matrix.` subdomain (the actual homeserver):

```
YOUR_DOMAIN           ->  <VPS IP>
matrix.YOUR_DOMAIN    ->  <VPS IP>
```

DNS propagation can take a few minutes to a few hours depending on your registrar/TTLs — the
certbot step below will fail with a timeout if it runs before records have propagated, so it's
worth confirming first: `dig +short app.YOUR_DOMAIN` from your own machine should return the VPS
IP for every name above before you continue.

## Step 2 — Install Docker and Docker Compose

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out/in (or `newgrp docker`) for this to take effect
```

Docker's install script pulls in the Compose plugin (`docker compose`, no hyphen) automatically.
Confirm with `docker compose version`.

## Step 3 — Get the repo onto the VPS

```bash
git clone https://github.com/YOUR_FORK/nekous.git
cd nekous
```

(Or `scp`/rsync it over if you're not using git on the VPS. Either way, everything from here on
assumes your working directory is the repo root.)

## Step 4 — Create the token server's bot account

**Skip this step entirely if you're using Option B** — the guided script registers this account
for you automatically (along with your own), against the homeserver it just provisioned. This
step is for Option A (bringing your own homeserver) only.

The token server (`services/token-server`) uses one dedicated Matrix account to check room
membership and power levels before handing out LiveKit tokens — see
[`docs/voice-architecture.md`](voice-architecture.md) for why. Create this account on your
**existing homeserver** (not something NekoUs's stack sets up):

**Via Element, Cinny, or any other client:** register a new account, e.g.
`@nekous-voice-bot:YOUR_DOMAIN`, the ordinary way. Then get a long-lived access token for it —
in Element: Settings → Help & About → Advanced → Access Token. Copy it somewhere safe; you'll
paste it into `.env` in Step 6. This is the easiest path if registration on your homeserver
allows it.

**Via the API instead**, if your homeserver has open registration:

```bash
curl -s https://YOUR_HOMESERVER/_matrix/client/v3/register \
  -d '{"username":"nekous-voice-bot","password":"<a strong password>","auth":{"type":"m.login.dummy"}}'
```

This returns an `access_token` directly in the response — no separate login step needed. If
registration requires a captcha, email verification, or a registration token on your homeserver,
register through whatever flow it actually requires instead, then log in to get a token:

```bash
curl -s https://YOUR_HOMESERVER/_matrix/client/v3/login \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"nekous-voice-bot"},"password":"<password>"}'
```

Either way you should end up with:
- `MATRIX_BOT_USER_ID` — the full `@nekous-voice-bot:YOUR_DOMAIN` (the `user_id` field)
- `MATRIX_BOT_ACCESS_TOKEN` — the `access_token` field

Sanity-check the token before moving on:

```bash
curl -s https://YOUR_HOMESERVER/_matrix/client/v3/account/whoami \
  -H "Authorization: Bearer <the access token>"
# should echo back {"user_id":"@nekous-voice-bot:YOUR_DOMAIN"}
```

This bot only ever needs to be **invited** into rooms/Spaces you want voice-gated (it auto-joins
on invite — see `services/token-server/src/membership.ts`). It never needs admin rights, and it
never reads encrypted message content, only room membership and power levels, which Matrix never
encrypts.

## Step 5 — Generate the stack's own secrets

```bash
# LiveKit's API key/secret pair — shared between the livekit and token-server services.
openssl rand -hex 16   # -> LIVEKIT_API_KEY
openssl rand -hex 16   # -> LIVEKIT_API_SECRET

# Web Push's VAPID key pair — no host Node.js install needed, borrow a throwaway container:
docker run --rm node:20-alpine npx --yes web-push generate-vapid-keys --json
```

## Step 6 — Write `.env`

```bash
cp .env.example .env
```

Fill in every value `.env.example` calls out, using what you generated above:

- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` — from Step 5
- `HOST_IP` — the VPS's public IP (`curl -4 ifconfig.me` prints it)
- `ALLOWED_ORIGINS` — `https://app.YOUR_DOMAIN`
- `MATRIX_HOMESERVER_URL` — your existing homeserver's URL, e.g. `https://matrix.YOUR_DOMAIN`
- `MATRIX_BOT_USER_ID` / `MATRIX_BOT_ACCESS_TOKEN` — from Step 4
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — from Step 5
- `VAPID_SUBJECT` — `mailto:you@YOUR_DOMAIN` (a real address the push service can contact if
  something's wrong with this deployment)

Leave `VOICE_MODERATOR_POWER_LEVEL` at its default unless you specifically want a different
threshold.

## Step 7 — TLS certificates

```bash
sudo apt update && sudo apt install -y certbot
sudo systemctl stop nginx 2>/dev/null   # free up port 80 if nginx is already installed/running

sudo certbot certonly --standalone \
  -d app.YOUR_DOMAIN -d livekit.YOUR_DOMAIN -d token.YOUR_DOMAIN -d push.YOUR_DOMAIN \
  --agree-tos -m you@YOUR_DOMAIN --no-eff-email
```

This gets you one certificate covering all four subdomains, at
`/etc/letsencrypt/live/app.YOUR_DOMAIN/{fullchain,privkey}.pem`. `--standalone` briefly binds
port 80 itself to answer the ACME challenge, which is why nginx needs to be stopped (or not yet
installed) first.

Set up auto-renewal with an nginx reload so renewed certs actually get picked up (certbot
installs a systemd timer automatically; this just adds the reload):

```bash
echo '#!/bin/sh
systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run   # confirms the whole renewal path works, changes nothing
```

## Step 8 — nginx reverse proxy

```bash
sudo apt install -y nginx
```

Copy `deploy/nginx/nginx-proxy.conf.example` to `/etc/nginx/sites-available/nekous.conf`,
replace every `YOUR_DOMAIN`, and point the two `ssl_certificate*` paths at the cert from Step 7
(`/etc/letsencrypt/live/app.YOUR_DOMAIN/fullchain.pem` and `.../privkey.pem` — the same pair in
every server block, since it's one multi-domain cert):

```bash
sudo cp deploy/nginx/nginx-proxy.conf.example /etc/nginx/sites-available/nekous.conf
sudo sed -i 's/YOUR_DOMAIN/your-actual-domain.com/g' /etc/nginx/sites-available/nekous.conf
sudo sed -i 's#/path/to/ssl/fullchain.pem#/etc/letsencrypt/live/app.your-actual-domain.com/fullchain.pem#g; s#/path/to/ssl/privkey.pem#/etc/letsencrypt/live/app.your-actual-domain.com/privkey.pem#g' /etc/nginx/sites-available/nekous.conf
sudo ln -s /etc/nginx/sites-available/nekous.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

(If you'd rather run each service on its own separate vhost file instead of one combined file,
`deploy/nginx/livekit.nginx.conf.example`, `token.nginx.conf.example`, and
`push.nginx.conf.example` are the same server blocks split out individually — functionally
identical, just organized differently.)

## Step 9 — Bring the stack up

```bash
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

Check everything actually started:

```bash
docker compose -f deploy/docker-compose.yml ps
curl -s http://127.0.0.1:3001/health   # token server
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080   # web client, expect 200
```

## Step 10 — The parts that live inside the app, not `.env`

Two settings are deliberately per-Space or per-account, configured in the running app itself
rather than baked into the image — see `docs/voice-architecture.md`'s "State events" section for
why:

- **Voice server, per Space** — open Space Settings for each Space you want voice/video in, and
  set the LiveKit URL (`wss://livekit.YOUR_DOMAIN`) and the token endpoint
  (`https://token.YOUR_DOMAIN`).
- **Push gateway, per account** — open Account Settings → Notifications and set the push
  gateway's URL (`https://push.YOUR_DOMAIN`).

At this point: log into `https://app.YOUR_DOMAIN` with your existing homeserver account, invite
the bot account from Step 4 into a voice-enabled Space, set the two URLs above, and you should be
able to join a voice channel.

## The guided script

`deploy/setup.sh` automates Steps 2, 5, 6, 7, 8, and 9 above, plus — for **Option B** only — Step
4 as well (it registers both the bot account and your own account itself, so there's nothing
homeserver-specific left for you to do by hand). DNS (Step 1) and the in-app config (Step 10)
still need you either way. Run it from the repo root on the VPS, as root:

```bash
sudo bash deploy/setup.sh
```

It's interactive, and asks early on whether you already have a homeserver (Option A) or want it
to provision one (Option B) — everything downstream of that answer adjusts accordingly:

- **Option A**: asks for your domain, VPS IP, homeserver URL, and bot credentials.
- **Option B**: asks for your domain, VPS IP, a local part for the bot account, and a local part
  + password for your own account — then, once the new homeserver is up, registers both
  automatically via its registration API (the bot's password is generated for you and never
  shown — only its resulting access token ends up in `.env`) and writes their credentials into
  `.env` itself.
- **Either way**, it also asks whether to enable the optional TURN relay hardening (default no)
  — see "TURN relay" below for what saying yes actually does.

Either way it checks for and installs missing tools (Docker, certbot, nginx), generates all the
secrets from Step 5 (plus a Matrix registration token for Option B), writes `.env`, requests a TLS
certificate covering every domain the chosen option needs, writes and enables the nginx config
(including the federation/well-known blocks for Option B), and brings the stack up — then prints
exactly what's left to do (Step 10), plus a firewall reminder about port 8448 for Option B. It
assumes the standard single-host topology (nginx and the docker-compose stack on the same box) —
for the split topology below, follow the manual steps instead; the script doesn't cover it. Safe
to re-run: it asks before overwriting an existing `.env`, and skips re-requesting a certificate
that's already valid.

## Variant: split edge-proxy + origin topology

Everything above assumes nginx and the docker-compose stack run on the same box. A common
alternative, especially if the actual app server sits behind Cloudflare and isn't meant to be
directly reachable: a small **edge box** with a public IP holds the TLS certs and nginx, and
proxies everything through a private network (typically a WireGuard tunnel) to an **origin box**
that runs `deploy/docker-compose.yml` and is never exposed to the internet directly.

What changes from the single-host guide:

- **DNS and certs (Steps 1, 7)** still point at the edge box's public IP and run there —
  unchanged.
- **The docker-compose stack (Step 9)** runs on the *origin* box instead, with `BIND_ADDR` in
  `.env` set to the origin's address on the private network (e.g. its WireGuard interface IP,
  `10.40.40.2`) instead of the default `127.0.0.1` — otherwise the edge box has no way to reach
  these ports at all. Never set it to `0.0.0.0`; these ports have no TLS or auth of their own,
  only the private network's own access control stands between them and anyone who can reach the
  origin box.
- **nginx's `location`/`proxy_pass` targets (Step 8)**, on the edge box, change from
  `127.0.0.1:<port>` to `10.40.40.2:<port>` (the origin's private address) for the four HTTP-ish
  ports (`8080` web, `3001` token server, `3002` push gateway, `7880` LiveKit signaling).
- **LiveKit's two raw media ports (`7881/tcp`, `7882/udp`) need a separate relay.** They carry
  WebRTC media, not HTTP, so an ordinary `location` block can't proxy them — that only works
  inside nginx's `http {}` context, and these aren't HTTP traffic. `deploy/nginx/stream-livekit.nginx.conf.example`
  relays them using nginx's `stream {}` context instead (a sibling of `http {}`, not nested in
  it) — copy it to the edge box, replace the origin address, and confirm the stream module is
  actually available first:

  ```bash
  nginx -V 2>&1 | grep -o with-stream
  ```

  If that prints nothing, your nginx build doesn't have it — on Debian/Ubuntu, `apt install
  nginx-full` (or `nginx-extras`) instead of the base `nginx` package usually provides it; a
  dynamic-module build instead needs `load_module modules/ngx_stream_module.so;` added at the
  very top of `/etc/nginx/nginx.conf`, before any `http {}`/`stream {}` block.

- **If you're replacing an existing setup that already has this working** (e.g. an old
  cinny-voice deployment using the same edge box and domains): the certs and DNS likely don't
  need to change at all — only the `proxy_pass`/`stream` targets, once they're pointed at the new
  origin's private address, and the `.env` on the new origin box. Check what's already in
  `/etc/nginx/sites-enabled/` and any existing `stream {}` config on the edge box before writing
  new files — updating the existing ones in place is usually less error-prone than adding a
  second, parallel config for the same domains.

## TURN relay (optional IP-hiding hardening)

`deploy/livekit.yaml` ships with a commented-out `turn:` block for relaying voice/video media
through a TURN server — useful if you want to hide the VPS's IP from call participants, or work
around a particularly hostile network. Not needed for a normal deployment. The guided script asks
about this right after the LiveKit subdomain prompt ("Hide this server's IP behind a TURN
relay...?") — say yes and it handles everything: one more DNS record (`turn.YOUR_DOMAIN`, included
automatically in the same certificate as everything else), copying the TLS cert into
`deploy/livekit-certs/` (gitignored — real key material, never committed) with a renewal hook that
refreshes it and restarts `livekit` automatically, and rewriting `deploy/livekit.yaml` with the
`turn:` block filled in. Doing this by hand instead means: add the DNS record yourself, add
`turn.YOUR_DOMAIN` to the certbot `-d` list in Step 7, copy the resulting cert into
`deploy/livekit-certs/{fullchain,privkey}.pem`, and uncomment/fill in `livekit.yaml`'s `turn:`
block yourself (`tls_port: 5349`, not 443 — this same host's nginx already owns 443).

Either way, this needs two more ports open at your provider's firewall/security-group level:
**5349/tcp** and **3478/udp**.

Note this doesn't disguise TURN traffic as ordinary HTTPS on port 443 the way a from-scratch setup
on a dedicated host could — nginx already owns 443 here for the four proxied services, so TURN
runs on the standard 5349 TURNS port instead, distinguishable by port number to anyone actually
looking. Still hides the origin IP behind the TURN relay's own IP, which is the main goal.

## Troubleshooting

- **Voice call connects but no audio/video, or only works between two people on the same
  network.** Almost always port 7882/udp (or 7881/tcp for privacy browsers that block UDP) not
  actually reaching the VPS — recheck your cloud provider's firewall/security group, not just
  `ufw`/`iptables` on the box itself. See "TURN relay" above if you want to hide the VPS's IP or
  work around a particularly hostile network; not needed for a normal deployment.
- **Token server rejects everyone ("not a member" or similar).** The bot account from Step 4
  needs to actually be *invited into* the room/Space, not just have an account — it can't read
  membership for rooms it hasn't joined.
- **(Option B) Other homeservers can't find yours / federation doesn't work.** Confirm
  `https://YOUR_DOMAIN/.well-known/matrix/server` actually returns
  `{"m.server": "matrix.YOUR_DOMAIN:443"}` from a browser or `curl` — if it doesn't, the bare
  apex domain's DNS record or nginx block is missing (see Step 1 and the guided script's nginx
  output). Also double check port **8448/tcp** is actually open at the provider firewall level,
  not just the OS firewall — this is the single most common miss, since it's easy to open 80/443
  and forget the federation port entirely.
- **CORS errors in the browser console calling the token server or push gateway.** `.env`'s
  `ALLOWED_ORIGINS` doesn't match the origin you're actually loading the app from — it has to be
  the exact scheme+host the browser bar shows (`https://app.YOUR_DOMAIN`, not `www.` or a bare
  IP).
- **Push notifications never arrive when no tab is open.** Check `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` in `.env` match the pair the push gateway was actually started with (a
  regenerated pair after the gateway's first run invalidates every existing subscription — see
  [`docs/push-notifications.md`](push-notifications.md)), and that the push gateway URL entered
  in Account Settings is reachable and correct.
- **`certbot certonly --standalone` times out or fails the challenge.** Almost always one of:
  DNS hasn't propagated yet (recheck with `dig`), port 80 is still bound by something else (`sudo
  lsof -i :80`), or the cloud firewall/security group blocks inbound port 80.
- **Let's Encrypt rate limits.** If you're testing repeatedly, add `--dry-run` to the `certbot
  certonly` command first, or use `--staging` to get a real (untrusted) cert without touching
  your production rate limit while you iterate on everything else.

## Maintaining a running deployment

- **Updating:** `git pull`, then `docker compose -f deploy/docker-compose.yml --env-file .env up
  -d --build` again — only changed images get rebuilt.
- **Cert renewal:** automatic via certbot's systemd timer (`systemctl list-timers | grep
  certbot`) plus the reload hook from Step 7 — nothing to do unless `certbot renew --dry-run`
  ever stops succeeding.
- **Logs:** `docker compose -f deploy/docker-compose.yml logs -f <service>` (`livekit`,
  `token-server`, `push-gateway`, or `web`).
- **Backups:** `.env` and `/etc/letsencrypt` are the only state outside of git and the Matrix
  homeserver itself (which holds all real user data) — everything else rebuilds from the repo.
