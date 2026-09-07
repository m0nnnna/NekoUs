#!/usr/bin/env bash
# Guided, interactive production setup for NekoUs — see docs/deployment.md for the full
# explanation of what each step below does and why. This script automates the mechanical parts
# of that guide (installing Docker/certbot/nginx, generating secrets, requesting a TLS
# certificate, writing the nginx config, bringing the docker-compose stack up); it deliberately
# does NOT create your Matrix homeserver's bot account (Step 4 in the guide) or set the two
# in-app settings (Step 10) — those need you.
#
# Run from the repo root, as root: sudo bash deploy/setup.sh
# Safe to re-run: it asks before overwriting an existing .env, and skips re-requesting a
# certificate that's already valid for the domains you enter.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

log()  { printf '\n==> %s\n' "$1"; }
warn() { printf '\n!!  %s\n' "$1" >&2; }
die()  { warn "$1"; exit 1; }

# ask NAME "Prompt text" "default"  -> sets $REPLY_VALUE
ask() {
  local __prompt="$1" __default="${2-}" __input
  if [ -n "$__default" ]; then
    read -r -p "$__prompt [$__default]: " __input || true
    REPLY_VALUE="${__input:-$__default}"
  else
    while true; do
      read -r -p "$__prompt: " __input || true
      if [ -n "$__input" ]; then REPLY_VALUE="$__input"; break; fi
      echo "  (required)"
    done
  fi
}

# ask_secret "Prompt text" -> sets $REPLY_VALUE, input not echoed
ask_secret() {
  local __prompt="$1" __input
  while true; do
    read -r -s -p "$__prompt: " __input || true
    echo
    if [ -n "$__input" ]; then REPLY_VALUE="$__input"; break; fi
    echo "  (required)"
  done
}

confirm() {
  local __prompt="$1" __default="${2:-y}" __input
  read -r -p "$__prompt [$([ "$__default" = y ] && echo 'Y/n' || echo 'y/N')]: " __input || true
  __input="${__input:-$__default}"
  case "$__input" in
    y|Y|yes|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# json_escape STRING -> prints STRING with backslashes/double-quotes escaped for embedding in a
# JSON string literal. Good enough for typical passwords/usernames; doesn't handle raw control
# characters, which don't show up in anything a person types at these prompts.
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# register_account LOCALPART PASSWORD REGISTRATION_TOKEN -> sets REGISTERED_USER_ID and
# REGISTERED_ACCESS_TOKEN. Talks to the freshly-provisioned homeserver's own client-server API
# (127.0.0.1:8008, before nginx/TLS are even involved) via the standard two-step UIAA registration
# flow Matrix homeservers use: the first call gets rejected with a session id and the list of
# required stages, the second call repeats the request with that session id plus the
# m.login.registration_token stage completed. Confirmed against a real Continuwuity container
# that a single follow-up call is enough here (no further stages) — see the README changelog
# entry for this feature for how that was verified.
register_account() {
  local __local="$1" __password="$2" __token="$3"
  local __esc_local __esc_pw __esc_token __session __resp
  __esc_local="$(json_escape "$__local")"
  __esc_pw="$(json_escape "$__password")"
  __esc_token="$(json_escape "$__token")"
  __resp="$(curl -s -X POST "http://127.0.0.1:8008/_matrix/client/v3/register" \
    -d "{\"username\":\"$__esc_local\",\"password\":\"$__esc_pw\"}")"
  __session="$(printf '%s' "$__resp" | grep -o '"session":"[^"]*"' | cut -d'"' -f4)"
  [ -n "$__session" ] || die "Registering @$__local on the new homeserver failed (no session in response: $__resp) — check: docker compose -f deploy/docker-compose.yml --profile matrix logs matrix"
  __resp="$(curl -s -X POST "http://127.0.0.1:8008/_matrix/client/v3/register" \
    -d "{\"username\":\"$__esc_local\",\"password\":\"$__esc_pw\",\"auth\":{\"type\":\"m.login.registration_token\",\"token\":\"$__esc_token\",\"session\":\"$__session\"}}")"
  REGISTERED_USER_ID="$(printf '%s' "$__resp" | grep -o '"user_id":"[^"]*"' | cut -d'"' -f4)"
  REGISTERED_ACCESS_TOKEN="$(printf '%s' "$__resp" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"
  [ -n "$REGISTERED_USER_ID" ] && [ -n "$REGISTERED_ACCESS_TOKEN" ] || die "Registering @$__local on the new homeserver failed (unexpected response: $__resp)"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

if [ "$(id -u)" -ne 0 ]; then
  die "Run this as root (sudo bash deploy/setup.sh) — it installs system packages and writes to /etc/nginx and /etc/letsencrypt."
fi

if ! need_cmd apt-get; then
  die "This script is written for Debian/Ubuntu (apt-get). Follow docs/deployment.md manually on other distros."
fi

log "NekoUs guided deploy — see docs/deployment.md for the full explanation of each step."

# ---------------------------------------------------------------------------
# Collect configuration
# ---------------------------------------------------------------------------

ask "Base domain (e.g. example.com)" ""
BASE_DOMAIN="$REPLY_VALUE"

ask "Web client subdomain" "app.$BASE_DOMAIN"
APP_DOMAIN="$REPLY_VALUE"
ask "LiveKit subdomain" "livekit.$BASE_DOMAIN"
LIVEKIT_DOMAIN="$REPLY_VALUE"

echo
if confirm "Hide this server's IP behind a TURN relay for voice/video (optional hardening, needs one more DNS record)?" n; then
  ENABLE_TURN=true
  ask "TURN domain" "turn.$BASE_DOMAIN"
  TURN_DOMAIN="$REPLY_VALUE"
else
  ENABLE_TURN=false
fi

ask "Token server subdomain" "token.$BASE_DOMAIN"
TOKEN_DOMAIN="$REPLY_VALUE"
ask "Push gateway subdomain" "push.$BASE_DOMAIN"
PUSH_DOMAIN="$REPLY_VALUE"

DETECTED_IP="$(curl -fsS -4 ifconfig.me 2>/dev/null || true)"
ask "This VPS's public IP" "$DETECTED_IP"
HOST_IP_VALUE="$REPLY_VALUE"

ask "Admin email (for TLS cert registration and push notifications)" ""
ADMIN_EMAIL="$REPLY_VALUE"

echo
echo "NekoUs is a Matrix client — it needs a homeserver to talk to."
if confirm "Do you already have a Matrix homeserver you want to use?" y; then
  PROVISION_MATRIX=false
else
  PROVISION_MATRIX=true
  MATRIX_DOMAIN="matrix.$BASE_DOMAIN"
  MATRIX_SERVER_NAME="$BASE_DOMAIN"
  echo
  echo "This script will provision a new Continuwuity homeserver (a lightweight, federation-"
  echo "capable Matrix server) for you at $MATRIX_DOMAIN, with accounts reading as"
  echo "@user:$BASE_DOMAIN."
fi

DNS_CHECK_DOMAINS=("$APP_DOMAIN" "$LIVEKIT_DOMAIN" "$TOKEN_DOMAIN" "$PUSH_DOMAIN")
if [ "$ENABLE_TURN" = true ]; then
  DNS_CHECK_DOMAINS+=("$TURN_DOMAIN")
fi
if [ "$PROVISION_MATRIX" = true ]; then
  DNS_CHECK_DOMAINS+=("$BASE_DOMAIN" "$MATRIX_DOMAIN")
fi

echo
echo "DNS check — each of the following should already point at $HOST_IP_VALUE:"
for d in "${DNS_CHECK_DOMAINS[@]}"; do
  resolved="$(getent hosts "$d" 2>/dev/null | awk '{print $1}' | head -n1 || true)"
  if [ "$resolved" = "$HOST_IP_VALUE" ]; then
    echo "  ok   $d -> $resolved"
  else
    echo "  WAIT $d -> ${resolved:-<not resolving>} (expected $HOST_IP_VALUE)"
  fi
done
if ! confirm "Continue anyway?" y; then
  die "Fix DNS first, then re-run this script."
fi

if [ "$PROVISION_MATRIX" = true ]; then
  log "New homeserver accounts (both get created automatically once the homeserver is up)"
  ask "Local part for the token server's bot account" "nekous-voice-bot"
  BOT_LOCALPART="$REPLY_VALUE"
  BOT_PASSWORD="$(openssl rand -base64 24)"
  echo "  ok   bot password generated (never shown anywhere — only its access token ends up in .env)"

  ask "Local part for your own account (this becomes the homeserver's admin)" ""
  ADMIN_LOCALPART="$REPLY_VALUE"
  ask_secret "Password for that account"
  ADMIN_PASSWORD="$REPLY_VALUE"
else
  log "Your existing Matrix homeserver (NOT one of the domains above — NekoUs is a client, not a homeserver)"
  ask "Homeserver URL (e.g. https://matrix.$BASE_DOMAIN)" ""
  HOMESERVER_URL="$REPLY_VALUE"

  echo
  echo "The token server needs a dedicated bot account on that homeserver — see docs/deployment.md"
  echo "Step 4 if you haven't created one yet (register an account, then grab a long-lived access"
  echo "token for it, e.g. via Element: Settings -> Help & About -> Advanced -> Access Token)."
  ask "Bot's full Matrix user ID (e.g. @nekous-voice-bot:$BASE_DOMAIN)" ""
  BOT_USER_ID="$REPLY_VALUE"
  ask_secret "Bot's access token"
  BOT_ACCESS_TOKEN="$REPLY_VALUE"

  echo "Verifying that access token against $HOMESERVER_URL ..."
  WHOAMI="$(curl -fsS -H "Authorization: Bearer $BOT_ACCESS_TOKEN" "$HOMESERVER_URL/_matrix/client/v3/account/whoami" 2>/dev/null || true)"
  if printf '%s' "$WHOAMI" | grep -q "$BOT_USER_ID"; then
    echo "  ok   token is valid for $BOT_USER_ID"
  else
    warn "Couldn't confirm that token against $HOMESERVER_URL (got: ${WHOAMI:-no response}). Continuing anyway — double check .env afterwards if voice calls don't work."
  fi
fi

# ---------------------------------------------------------------------------
# Install missing tools
# ---------------------------------------------------------------------------

log "Checking required tools"

if ! need_cmd docker; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  die "Docker installed but the 'docker compose' plugin isn't available — install docker-compose-plugin and re-run."
fi

for pkg_cmd in "certbot:certbot" "nginx:nginx" "openssl:openssl"; do
  pkg="${pkg_cmd%%:*}"; cmd="${pkg_cmd##*:}"
  if ! need_cmd "$cmd"; then
    log "Installing $pkg"
    apt-get update -qq && apt-get install -y "$pkg"
  fi
done

echo "  ok   docker, docker compose, certbot, nginx, openssl all present"

# ---------------------------------------------------------------------------
# Generate secrets
# ---------------------------------------------------------------------------

log "Generating secrets"

LIVEKIT_API_KEY="$(openssl rand -hex 16)"
LIVEKIT_API_SECRET="$(openssl rand -hex 16)"
echo "  ok   LiveKit API key/secret"

if [ "$PROVISION_MATRIX" = true ]; then
  MATRIX_REGISTRATION_TOKEN="$(openssl rand -hex 32)"
  echo "  ok   Matrix registration token"
fi

VAPID_JSON="$(docker run --rm node:20-alpine npx --yes web-push generate-vapid-keys --json 2>/dev/null || true)"
VAPID_PUBLIC_KEY="$(printf '%s' "$VAPID_JSON" | grep -o '"publicKey":"[^"]*"' | cut -d'"' -f4)"
VAPID_PRIVATE_KEY="$(printf '%s' "$VAPID_JSON" | grep -o '"privateKey":"[^"]*"' | cut -d'"' -f4)"
if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
  die "Couldn't generate VAPID keys automatically (docker run node:20-alpine failed?). Run 'npx web-push generate-vapid-keys' yourself and fill VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY into .env manually, then re-run."
fi
echo "  ok   VAPID key pair for push notifications"

# ---------------------------------------------------------------------------
# .env
# ---------------------------------------------------------------------------

if [ -f .env ] && ! confirm "$(printf '\n.env already exists — overwrite it?')" n; then
  log "Keeping existing .env"
else
  log "Writing .env"
  {
    cat <<ENV_EOF
# Generated by deploy/setup.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) — see .env.example for what each
# of these means, and docs/deployment.md for the full guide.

LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
HOST_IP=$HOST_IP_VALUE
ALLOWED_ORIGINS=https://$APP_DOMAIN

VOICE_MODERATOR_POWER_LEVEL=50

VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
VAPID_SUBJECT=mailto:$ADMIN_EMAIL
ENV_EOF
    if [ "$PROVISION_MATRIX" = true ]; then
      cat <<MATRIX_ENV_EOF

MATRIX_SERVER_NAME=$MATRIX_SERVER_NAME
MATRIX_REGISTRATION_TOKEN=$MATRIX_REGISTRATION_TOKEN
# MATRIX_HOMESERVER_URL / MATRIX_BOT_USER_ID / MATRIX_BOT_ACCESS_TOKEN get appended below once the
# new homeserver is up and its accounts are created.
MATRIX_ENV_EOF
    else
      cat <<EXISTING_ENV_EOF

MATRIX_HOMESERVER_URL=$HOMESERVER_URL
MATRIX_BOT_USER_ID=$BOT_USER_ID
MATRIX_BOT_ACCESS_TOKEN=$BOT_ACCESS_TOKEN
EXISTING_ENV_EOF
    fi
  } > .env
  chmod 600 .env
  echo "  ok   wrote .env (mode 600)"
fi

# ---------------------------------------------------------------------------
# TLS certificate
# ---------------------------------------------------------------------------

CERT_DIR="/etc/letsencrypt/live/$APP_DOMAIN"
if [ -d "$CERT_DIR" ] && confirm "A certificate for $APP_DOMAIN already exists — skip requesting a new one?" y; then
  log "Reusing existing certificate at $CERT_DIR"
else
  log "Requesting a TLS certificate (stopping nginx briefly to free port 80)"
  systemctl stop nginx 2>/dev/null || true
  CERTBOT_DOMAIN_ARGS=()
  for d in "${DNS_CHECK_DOMAINS[@]}"; do
    CERTBOT_DOMAIN_ARGS+=(-d "$d")
  done
  certbot certonly --standalone \
    "${CERTBOT_DOMAIN_ARGS[@]}" \
    --agree-tos -m "$ADMIN_EMAIL" --no-eff-email --non-interactive \
    || die "certbot failed — check DNS has propagated for all domains and that port 80 is reachable from the internet, then re-run."

  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK_EOF'
#!/bin/sh
systemctl reload nginx
HOOK_EOF
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
  echo "  ok   certificate issued, renewal reload-hook installed"
fi

if [ "$ENABLE_TURN" = true ]; then
  log "Copying the TLS cert into deploy/livekit-certs for LiveKit's TURN relay"
  # LiveKit reads its own files, not /etc/letsencrypt directly (that path is Docker-host-only,
  # not visible inside the container) — copying into a repo-local directory that's already bind-
  # mounted into the livekit service (docker-compose.yml) is simpler than adding a second mount
  # of the real letsencrypt tree.
  mkdir -p deploy/livekit-certs
  cp "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem" deploy/livekit-certs/
  chmod 644 deploy/livekit-certs/fullchain.pem
  chmod 600 deploy/livekit-certs/privkey.pem
  echo "  ok   copied to deploy/livekit-certs/"

  cat > /etc/letsencrypt/renewal-hooks/deploy/refresh-livekit-turn-cert.sh <<HOOK_EOF
#!/bin/sh
cp "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem" "$REPO_ROOT/deploy/livekit-certs/"
cd "$REPO_ROOT" && docker compose -f deploy/docker-compose.yml restart livekit
HOOK_EOF
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/refresh-livekit-turn-cert.sh
  echo "  ok   renewal hook installed (keeps the TURN cert fresh and restarts livekit automatically)"

  log "Enabling the TURN relay in deploy/livekit.yaml"
  # A full rewrite rather than editing the checked-in file in place — simpler and less fragile
  # than patching around the commented-out turn: block with sed, at the cost of overwriting any
  # hand edits to livekit.yaml once TURN is turned on. Re-running setup.sh with TURN enabled
  # rewrites this file again every time; leave TURN off if you've customized this file by hand
  # and don't want it touched.
  #
  # tls_port 5349 (the standard TURNS port) rather than 443 — this same host's nginx already owns
  # 443 for the four proxied services above, so LiveKit can't also bind it. That means TURN
  # traffic here is NOT disguised as ordinary HTTPS the way running it on a dedicated host with a
  # free 443 would allow — still hides the origin IP behind the TURN relay's own IP, just
  # distinguishable as TURN by port number to anyone actually looking. Good enough for the
  # "hide my home IP" goal; a from-scratch nginx `stream {}` SNI-passthrough setup could reclaim
  # 443 for this too, but that's real added complexity this guided script doesn't attempt.
  cat > deploy/livekit.yaml <<LIVEKIT_EOF
# LiveKit server configuration — regenerated by deploy/setup.sh with the TURN relay enabled for
# $TURN_DOMAIN. See docs/deployment.md's TURN section and docs/voice-architecture.md for how this
# fits into the overall voice flow.

port: 7880

rtc:
  udp_port: 7882
  tcp_port: 7881
  allow_tcp_fallback: true
  use_external_ip: false

turn:
  enabled: true
  domain: $TURN_DOMAIN
  tls_port: 5349
  udp_port: 3478
  cert_file: /etc/livekit/certs/fullchain.pem
  key_file: /etc/livekit/certs/privkey.pem

# Overridden at runtime by the LIVEKIT_KEYS env var (docker-compose.yml), sourced from .env.
keys:
  placeholder: not-used-in-docker

logging:
  level: info

room:
  max_participants: 50
  empty_timeout: 300
  departure_timeout: 20
  # NOTE: enabled_codecs, once specified, REPLACES LiveKit's entire built-in codec list rather
  # than adding to it — omitting audio/opus here would silently break every mic publish.
  enabled_codecs:
    - mime: audio/opus
    - mime: video/h264
    - mime: video/vp8
LIVEKIT_EOF
  echo "  ok   wrote deploy/livekit.yaml with TURN enabled for $TURN_DOMAIN"
fi

# ---------------------------------------------------------------------------
# nginx
# ---------------------------------------------------------------------------

log "Writing nginx config"

cat > /etc/nginx/sites-available/nekous.conf <<NGINX_EOF
server {
    listen 443 ssl http2;
    server_name $APP_DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api/livekit/ {
        proxy_pass http://127.0.0.1:3001/api/livekit/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name $LIVEKIT_DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}

server {
    listen 443 ssl http2;
    server_name $TOKEN_DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name $PUSH_DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX_EOF

REDIRECT_DOMAINS="$APP_DOMAIN $LIVEKIT_DOMAIN $TOKEN_DOMAIN $PUSH_DOMAIN"

if [ "$PROVISION_MATRIX" = true ]; then
  REDIRECT_DOMAINS="$REDIRECT_DOMAINS $BASE_DOMAIN $MATRIX_DOMAIN"
  echo "  ok   adding nginx blocks for the new homeserver ($MATRIX_DOMAIN, federation on 8448," \
       "well-known delegation on $BASE_DOMAIN)"
  cat >> /etc/nginx/sites-available/nekous.conf <<MATRIX_NGINX_EOF

server {
    listen 443 ssl http2;
    server_name $MATRIX_DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    # Continuwuity's own docs ask for this — its default request-body limit is smaller than
    # Matrix media uploads typically need.
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    # Server-to-server federation traffic — a separate port because it can't share 443's TLS
    # SNI/cert-selection the way a browser client request can; same backend either way.
    listen 8448 ssl http2;
    server_name $MATRIX_DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8008;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    # The bare domain is never a real endpoint of its own — it only exists so Matrix user IDs
    # read as a clean @user:$BASE_DOMAIN while the actual homeserver runs at $MATRIX_DOMAIN.
    # These two well-known files are what tells other homeservers (and clients) where to find it.
    listen 443 ssl http2;
    server_name $BASE_DOMAIN;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;

    location = /.well-known/matrix/server {
        default_type application/json;
        return 200 '{"m.server": "$MATRIX_DOMAIN:443"}';
    }
    location = /.well-known/matrix/client {
        default_type application/json;
        add_header Access-Control-Allow-Origin *;
        return 200 '{"m.homeserver": {"base_url": "https://$MATRIX_DOMAIN"}}';
    }
    location / {
        return 301 https://$APP_DOMAIN\$request_uri;
    }
}
MATRIX_NGINX_EOF
fi

cat >> /etc/nginx/sites-available/nekous.conf <<REDIRECT_EOF

server {
    listen 80;
    server_name $REDIRECT_DOMAINS;
    return 301 https://\$host\$request_uri;
}
REDIRECT_EOF

ln -sf /etc/nginx/sites-available/nekous.conf /etc/nginx/sites-enabled/nekous.conf
nginx -t || die "nginx config test failed — check /etc/nginx/sites-available/nekous.conf"
systemctl restart nginx
echo "  ok   nginx configured and running"

# ---------------------------------------------------------------------------
# Bring the stack up
# ---------------------------------------------------------------------------

COMPOSE_PROFILE_ARGS=()
if [ "$PROVISION_MATRIX" = true ]; then
  COMPOSE_PROFILE_ARGS=(--profile matrix)

  log "Starting the new homeserver first (its accounts need to exist before the rest of the stack can use them)"
  docker compose -f deploy/docker-compose.yml --env-file .env "${COMPOSE_PROFILE_ARGS[@]}" up -d --build matrix

  log "Waiting for it to come up"
  MATRIX_UP=false
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:8008/_matrix/client/versions" 2>/dev/null; then
      MATRIX_UP=true
      break
    fi
    sleep 2
  done
  [ "$MATRIX_UP" = true ] || die "The new homeserver didn't come up in time — check: docker compose -f deploy/docker-compose.yml --profile matrix logs matrix"
  echo "  ok   homeserver is up"

  log "Reading its one-time bootstrap registration token"
  # Continuwuity generates and logs its OWN one-time token for the very first account — the
  # MATRIX_REGISTRATION_TOKEN we configured only activates once that first account exists.
  # Confirmed live against a real container; see the README changelog entry for this feature.
  # Continuwuity's startup log ALSO prints an unrelated later line containing the literal words
  # "registration token you" (a warning that the *configured* token won't work yet) — matching
  # on the one line that actually names the token, not just any "registration token" occurrence,
  # is what a naive grep got wrong the first time this was tested live.
  ESC="$(printf '\033')"
  BOOT_TOKEN="$(docker compose -f deploy/docker-compose.yml --profile matrix logs matrix 2>&1 \
    | grep -a 'Pick your own username' \
    | sed "s/${ESC}\[[0-9;]*m//g" \
    | sed -n 's/.*registration token \([A-Za-z0-9]*\) \..*/\1/p' \
    | tail -n1)"
  [ -n "$BOOT_TOKEN" ] || die "Couldn't find the homeserver's bootstrap registration token in its logs — check: docker compose -f deploy/docker-compose.yml --profile matrix logs matrix"

  log "Creating your admin account (@$ADMIN_LOCALPART:$BASE_DOMAIN)"
  register_account "$ADMIN_LOCALPART" "$ADMIN_PASSWORD" "$BOOT_TOKEN"
  echo "  ok   $REGISTERED_USER_ID created — this is what you log into NekoUs with"

  log "Creating the token server's bot account (@$BOT_LOCALPART:$BASE_DOMAIN)"
  register_account "$BOT_LOCALPART" "$BOT_PASSWORD" "$MATRIX_REGISTRATION_TOKEN"
  BOT_USER_ID="$REGISTERED_USER_ID"
  BOT_ACCESS_TOKEN="$REGISTERED_ACCESS_TOKEN"
  echo "  ok   $BOT_USER_ID created"

  log "Adding the bot's credentials to .env"
  cat >> .env <<BOT_ENV_EOF

MATRIX_HOMESERVER_URL=https://$MATRIX_DOMAIN
MATRIX_BOT_USER_ID=$BOT_USER_ID
MATRIX_BOT_ACCESS_TOKEN=$BOT_ACCESS_TOKEN
BOT_ENV_EOF
  echo "  ok   .env updated"
fi

log "Building and starting the rest of the NekoUs stack (this can take a few minutes the first time)"
docker compose -f deploy/docker-compose.yml --env-file .env "${COMPOSE_PROFILE_ARGS[@]}" up -d --build

log "Checking service health"
sleep 3
if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
  echo "  ok   token server"
else
  warn "token server didn't respond on /health yet — check: docker compose -f deploy/docker-compose.yml logs token-server"
fi
if curl -fsS -o /dev/null http://127.0.0.1:8080 2>/dev/null; then
  echo "  ok   web client"
else
  warn "web client didn't respond yet — check: docker compose -f deploy/docker-compose.yml logs web"
fi

# ---------------------------------------------------------------------------
# Done — what's left
# ---------------------------------------------------------------------------

log "Stack is up. Two things still need doing inside the app itself (see docs/deployment.md Step 10):"

LOG_SERVICES="livekit|token-server|push-gateway|web"
if [ "$PROVISION_MATRIX" = true ]; then
  LOGIN_LINE="log in as @$ADMIN_LOCALPART:$BASE_DOMAIN (the account just created — it's the homeserver's admin)"
  UPDATE_CMD="git pull && docker compose -f deploy/docker-compose.yml --env-file .env --profile matrix up -d --build"
  LOG_SERVICES="$LOG_SERVICES|matrix"
else
  LOGIN_LINE="log in with your existing homeserver account"
  UPDATE_CMD="git pull && docker compose -f deploy/docker-compose.yml --env-file .env up -d --build"
fi

FIREWALL_NOTE=""
if [ "$PROVISION_MATRIX" = true ]; then
  FIREWALL_NOTE="$FIREWALL_NOTE
Also open port 8448/tcp (Matrix federation) at your provider's firewall/security-group level,
alongside 80/443/7881/7882 — the new homeserver won't federate without it."
fi
if [ "$ENABLE_TURN" = true ]; then
  FIREWALL_NOTE="$FIREWALL_NOTE
Also open ports 5349/tcp and 3478/udp (TURN relay) at your provider's firewall/security-group
level, alongside 80/443/7881/7882 — the TURN relay won't work without them."
fi

cat <<SUMMARY

  1. Open https://$APP_DOMAIN, $LOGIN_LINE, invite
     $BOT_USER_ID into any Space you want voice/video in, then in that Space's Settings set:
       LiveKit URL:      wss://$LIVEKIT_DOMAIN
       Token endpoint:   https://$TOKEN_DOMAIN

  2. In Account Settings -> Notifications, set the push gateway URL:
       https://$PUSH_DOMAIN
$FIREWALL_NOTE
Logs:    docker compose -f deploy/docker-compose.yml logs -f <$LOG_SERVICES>
Update:  $UPDATE_CMD
SUMMARY
