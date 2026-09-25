#!/usr/bin/env bash
# Guided, interactive production setup for Purrlor — see docs/deployment.md for the full
# explanation of what each step below does and why. This script automates the mechanical parts
# of that guide: an optional outbound proxy, installing Docker/certbot/nginx, provisioning a
# Matrix homeserver (Continuwuity) with your admin account and the voice bot's account already
# created — or wiring up one you already run — generating secrets, requesting a TLS certificate,
# writing the nginx config, locking the web client to that homeserver, and bringing the
# docker-compose stack up. The two in-app settings (Step 10 in the guide) still need you.
#
# Run from the repo root, as root: sudo bash deploy/setup.sh
# Safe to re-run: it asks before overwriting an existing .env (keeping it keeps every secret and
# account in it), skips accounts that already exist, and skips re-requesting a certificate that's
# already valid for the domains you enter.

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

# ask_new_password "Prompt text" -> sets $REPLY_VALUE; asks twice, at least 8 characters (the
# same minimum Purrlor's own register screen enforces).
ask_new_password() {
  local __prompt="$1" __first
  while true; do
    ask_secret "$__prompt"
    __first="$REPLY_VALUE"
    if [ "${#__first}" -lt 8 ]; then echo "  (at least 8 characters)"; continue; fi
    ask_secret "Type it again"
    if [ "$REPLY_VALUE" = "$__first" ]; then break; fi
    echo "  (didn't match — try again)"
  done
}

# choose "Prompt" DEFAULT_NUMBER "label 1" "label 2" ... -> sets $REPLY_CHOICE to the number picked
choose() {
  local __prompt="$1" __default="$2" __input __i=1
  shift 2
  echo "$__prompt"
  for __label in "$@"; do
    echo "  $__i) $__label"
    __i=$((__i + 1))
  done
  while true; do
    read -r -p "Choice [$__default]: " __input || true
    __input="${__input:-$__default}"
    if [ "$__input" -ge 1 ] 2>/dev/null && [ "$__input" -le "$#" ]; then REPLY_CHOICE="$__input"; return; fi
    echo "  (pick 1-$#)"
  done
}

# env_set KEY VALUE -> sets KEY=VALUE in .env, replacing an existing line for KEY rather than
# appending a duplicate (so re-runs don't pile up conflicting values).
env_set() {
  local __key="$1" __value="$2" __tmp
  __tmp="$(mktemp)"
  if [ -f .env ]; then grep -v "^$__key=" .env > "$__tmp" || true; fi
  printf '%s=%s\n' "$__key" "$__value" >> "$__tmp"
  cat "$__tmp" > .env
  rm -f "$__tmp"
  chmod 600 .env
}

# mask_url URL -> the URL with any user:password@ replaced by ***@, for printing.
mask_url() { printf '%s' "$1" | sed -E 's#^([a-zA-Z]+://)[^@/]*@#\1***@#'; }

# The host part of a proxy URL (no scheme, credentials, port or path).
url_host() { printf '%s' "$1" | sed -E 's#^[a-zA-Z]+://##; s#^[^@/]*@##; s#[:/].*$##'; }

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

# username_taken LOCALPART -> succeeds if that account already exists on the new homeserver (a
# re-run over an existing data volume). The spec's availability check answers M_USER_IN_USE for a
# taken name; anything else (available, or an invalid name) is left for registration to report.
username_taken() {
  curl -s "http://127.0.0.1:8008/_matrix/client/v3/register/available?username=$1" | grep -q M_USER_IN_USE
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

log "Purrlor guided deploy — see docs/deployment.md for the full explanation of each step."

# ---------------------------------------------------------------------------
# Outbound proxy (first, because everything after this may need the internet)
# ---------------------------------------------------------------------------

# Every in-stack hostname, plus loopback: container-to-container traffic (token-server ->
# livekit:7880, token-server -> matrix:8008) and this script's own health checks must never be
# sent to the proxy.
DEFAULT_NO_PROXY="localhost,127.0.0.1,::1,livekit,token-server,push-gateway,web,matrix"
OUTBOUND_PROXY=""
OUTBOUND_NO_PROXY=""

log "Outbound proxy"
echo "Some networks only reach the internet through an HTTP(S) proxy (a corporate egress proxy,"
echo "or one you use to keep this server's own IP out of outgoing requests). If so, this script"
echo "uses it for its own downloads and configures Docker, certificate renewal, and the services"
echo "that make outbound requests (federation, push delivery, OpenID checks) to use it too."
echo "Inbound traffic — people reaching Purrlor, and voice/video media — is unaffected."
if confirm "Does this server need an outbound proxy to reach the internet?" n; then
  while true; do
    ask "Proxy URL (http://[user:password@]host:port)" ""
    if printf '%s' "$REPLY_VALUE" | grep -Eq '^https?://[^[:space:]]+$'; then break; fi
    echo "  (must start with http:// or https:// — SOCKS isn't supported by the Node services)"
  done
  OUTBOUND_PROXY="$REPLY_VALUE"

  case "$(url_host "$OUTBOUND_PROXY")" in
    localhost|127.*|::1)
      warn "That proxy is on this host's loopback address, which containers can't reach — the stack's
    own outbound requests (and its image builds) would fail. Use an address containers can reach,
    e.g. this host's LAN IP or the Docker bridge address (usually 172.17.0.1) with the proxy
    listening there."
      confirm "Use it anyway?" n || die "Re-run with a proxy address reachable from containers."
      ;;
  esac

  ask "Extra hosts that should bypass the proxy (comma-separated, blank for none)" "-"
  OUTBOUND_NO_PROXY="$DEFAULT_NO_PROXY"
  if [ "$REPLY_VALUE" != "-" ]; then OUTBOUND_NO_PROXY="$OUTBOUND_NO_PROXY,$REPLY_VALUE"; fi

  # This script's own curl/apt/certbot/get.docker.com calls. Both spellings, since tools
  # disagree about which one they read.
  export http_proxy="$OUTBOUND_PROXY" https_proxy="$OUTBOUND_PROXY" no_proxy="$OUTBOUND_NO_PROXY"
  export HTTP_PROXY="$OUTBOUND_PROXY" HTTPS_PROXY="$OUTBOUND_PROXY" NO_PROXY="$OUTBOUND_NO_PROXY"

  echo "Testing $(mask_url "$OUTBOUND_PROXY") ..."
  EGRESS_IP="$(curl -fsS -4 -m 15 https://ifconfig.me 2>/dev/null || true)"
  if [ -n "$EGRESS_IP" ]; then
    echo "  ok   proxy works — outbound requests will appear to come from $EGRESS_IP"
  else
    warn "Couldn't reach https://ifconfig.me through that proxy."
    confirm "Continue anyway?" n || die "Check the proxy URL (and credentials), then re-run."
  fi
fi

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

# Never through the proxy: this is the address people and other servers reach THIS host on, which
# with a proxy configured is exactly what ifconfig.me would otherwise not report. Comes back empty
# on a network with no direct egress at all — then it's typed in by hand.
DETECTED_IP="$(curl -fsS -4 -m 10 --noproxy '*' ifconfig.me 2>/dev/null || true)"
ask "This VPS's public IP" "$DETECTED_IP"
HOST_IP_VALUE="$REPLY_VALUE"

ask "Admin email (for TLS cert registration and push notifications)" ""
ADMIN_EMAIL="$REPLY_VALUE"

log "Matrix homeserver"
echo "Purrlor is a Matrix client — it needs a homeserver to talk to. This install can run one for"
echo "you on this same server (Continuwuity: a lightweight, federation-capable Matrix server with"
echo "no separate database to manage), with your admin account and the voice bot's account"
echo "created automatically. Only say no if you already run a homeserver you want to use instead."
if confirm "Set up a new Matrix homeserver as part of this install?" y; then
  PROVISION_MATRIX=true
  MATRIX_DOMAIN="matrix.$BASE_DOMAIN"
  MATRIX_SERVER_NAME="$BASE_DOMAIN"
  echo
  echo "  It will be served at https://$MATRIX_DOMAIN, with accounts reading as @user:$BASE_DOMAIN."
  echo "  That server name is permanent — it's baked into every account and room it ever creates."
  confirm "Use $BASE_DOMAIN as the server name?" y || die "Re-run with the base domain you want in user IDs."

  echo
  choose "Who can create accounts on it?" 1 \
    "Invite-only: sign-up needs a registration token you hand out (recommended)" \
    "Closed: only you and the voice bot; add people later from the admin room"
  if [ "$REPLY_CHOICE" = 1 ]; then MATRIX_REGISTRATION_MODE=token; else MATRIX_REGISTRATION_MODE=closed; fi
else
  PROVISION_MATRIX=false
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
  ask "Local part for the token server's bot account" "purrlor-voice-bot"
  BOT_LOCALPART="$REPLY_VALUE"
  BOT_PASSWORD="$(openssl rand -base64 24)"
  echo "  ok   bot password generated (never shown anywhere — only its access token ends up in .env)"

  ask "Local part for your own account (this becomes the homeserver's admin)" ""
  ADMIN_LOCALPART="$REPLY_VALUE"
  ask_new_password "Password for that account"
  ADMIN_PASSWORD="$REPLY_VALUE"

  # The web client talks to it at its public URL, like any other Matrix client would.
  PURRLOR_HOMESERVER_URL="https://$MATRIX_DOMAIN"
else
  log "Your existing Matrix homeserver (NOT one of the domains above — Purrlor is a client, not a homeserver)"
  ask "Homeserver URL (e.g. https://matrix.$BASE_DOMAIN)" ""
  HOMESERVER_URL="$REPLY_VALUE"

  echo
  echo "The token server needs a dedicated bot account on that homeserver — see docs/deployment.md"
  echo "Step 4 if you haven't created one yet (register an account, then grab a long-lived access"
  echo "token for it, e.g. via Element: Settings -> Help & About -> Advanced -> Access Token)."
  ask "Bot's full Matrix user ID (e.g. @purrlor-voice-bot:$BASE_DOMAIN)" ""
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

  PURRLOR_HOMESERVER_URL="$HOMESERVER_URL"
fi

echo
echo "The web client can be locked to this homeserver: its login and register screens then show"
echo "$PURRLOR_HOMESERVER_URL instead of asking for a homeserver. Say no only if people should be"
echo "able to use this Purrlor deployment with accounts on other Matrix servers."
if ! confirm "Lock the web client to $PURRLOR_HOMESERVER_URL?" y; then
  PURRLOR_HOMESERVER_URL=""
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

# write_systemd_proxy_dropin UNIT -> writes (or refreshes) a drop-in giving UNIT the proxy
# variables. Prints "changed" when the file's content actually changed, so the caller only
# restarts what it has to. Mode 600: the proxy URL may carry credentials, and systemd reads
# drop-ins as root anyway.
write_systemd_proxy_dropin() {
  local __unit="$1" __dir="/etc/systemd/system/$1.d" __file __new
  __file="$__dir/purrlor-proxy.conf"
  # systemd expands %-specifiers in Environment=, and a percent-encoded proxy password is full
  # of them — %% is a literal %.
  local __p="${OUTBOUND_PROXY//%/%%}" __n="${OUTBOUND_NO_PROXY//%/%%}"
  __new="$(printf '# Written by Purrlor deploy/setup.sh — outbound proxy for %s.\n[Service]\nEnvironment="HTTP_PROXY=%s" "HTTPS_PROXY=%s" "NO_PROXY=%s"\n' \
    "$__unit" "$__p" "$__p" "$__n")"
  if [ -f "$__file" ] && [ "$(cat "$__file")" = "$__new" ]; then return; fi
  mkdir -p "$__dir"
  printf '%s\n' "$__new" > "$__file"
  chmod 600 "$__file"
  echo changed
}

if [ -n "$OUTBOUND_PROXY" ]; then
  log "Configuring the outbound proxy for Docker and certificate renewal"

  if [ "$(write_systemd_proxy_dropin docker.service)" = changed ]; then
    systemctl daemon-reload
    if [ -n "$(docker ps -q 2>/dev/null)" ]; then
      warn "Docker has to restart to pick up the proxy, which briefly stops the containers already
    running on this host (ones with a restart policy come back on their own)."
      confirm "Restart Docker now?" y || die "Docker can't pull images through the proxy until it restarts — re-run when it's OK to."
    fi
    systemctl restart docker
    echo "  ok   Docker daemon uses the proxy for image pulls"
  else
    echo "  ok   Docker daemon already configured for this proxy"
  fi

  # certbot's renewal runs from a systemd timer, outside this script's environment — without this
  # it can't reach Let's Encrypt, and certificates quietly expire in ~90 days. apt's certbot and
  # the snap one name their unit differently.
  CERTBOT_UNIT=""
  for unit in certbot.service snap.certbot.renew.service; do
    if systemctl cat "$unit" >/dev/null 2>&1; then CERTBOT_UNIT="$unit"; break; fi
  done
  if [ -n "$CERTBOT_UNIT" ]; then
    if [ "$(write_systemd_proxy_dropin "$CERTBOT_UNIT")" = changed ]; then systemctl daemon-reload; fi
    echo "  ok   certificate renewal ($CERTBOT_UNIT) uses the proxy"
  else
    warn "Couldn't find certbot's renewal service to give it the proxy — renewals may fail. Set
    HTTPS_PROXY for whatever runs 'certbot renew' on this host."
  fi
fi

# ---------------------------------------------------------------------------
# .env — keep the existing one, or generate secrets and write a new one
# ---------------------------------------------------------------------------

# env_get KEY -> prints KEY's value from .env (empty if absent). Reads single keys instead of
# sourcing the file, so a hand-edited .env with something shell-unfriendly in it can't break this.
env_get() { grep "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- || true; }

KEEP_ENV=false
if [ -f .env ] && ! confirm "$(printf '\n.env already exists — overwrite it? (no = keep every secret and account in it, and only update the settings asked about above)')" n; then
  KEEP_ENV=true
fi

if [ "$KEEP_ENV" = true ]; then
  log "Keeping existing .env, updating this run's settings in it"
  env_set PURRLOR_HOMESERVER_URL "$PURRLOR_HOMESERVER_URL"
  env_set OUTBOUND_PROXY "$OUTBOUND_PROXY"
  env_set OUTBOUND_NO_PROXY "$OUTBOUND_NO_PROXY"

  if [ "$PROVISION_MATRIX" = true ]; then
    EXISTING_SERVER_NAME="$(env_get MATRIX_SERVER_NAME)"
    if [ -n "$EXISTING_SERVER_NAME" ] && [ "$EXISTING_SERVER_NAME" != "$MATRIX_SERVER_NAME" ]; then
      die "This .env's homeserver is named $EXISTING_SERVER_NAME, not $MATRIX_SERVER_NAME — a homeserver's name can't change once it has data. Re-run with base domain $EXISTING_SERVER_NAME."
    fi
    env_set COMPOSE_PROFILES matrix
    env_set MATRIX_SERVER_NAME "$MATRIX_SERVER_NAME"
    # Reuse the token the running homeserver already has, so the bot registration below (if it
    # still needs doing) matches it.
    MATRIX_REGISTRATION_TOKEN="$(env_get MATRIX_REGISTRATION_TOKEN)"
    if [ -z "$MATRIX_REGISTRATION_TOKEN" ]; then
      MATRIX_REGISTRATION_TOKEN="$(openssl rand -hex 32)"
      env_set MATRIX_REGISTRATION_TOKEN "$MATRIX_REGISTRATION_TOKEN"
    fi
    # Registration has to be open while setup creates accounts; it's closed again below if chosen.
    env_set MATRIX_ALLOW_REGISTRATION true
  else
    env_set MATRIX_HOMESERVER_URL "$HOMESERVER_URL"
    env_set MATRIX_BOT_USER_ID "$BOT_USER_ID"
    env_set MATRIX_BOT_ACCESS_TOKEN "$BOT_ACCESS_TOKEN"
  fi
  echo "  ok   .env updated"
else
  log "Generating secrets"

  LIVEKIT_API_KEY="$(openssl rand -hex 16)"
  LIVEKIT_API_SECRET="$(openssl rand -hex 16)"
  echo "  ok   LiveKit API key/secret"

  if [ "$PROVISION_MATRIX" = true ]; then
    MATRIX_REGISTRATION_TOKEN="$(openssl rand -hex 32)"
    echo "  ok   Matrix registration token"
  fi

  VAPID_JSON="$(docker run --rm -e HTTPS_PROXY="$OUTBOUND_PROXY" -e HTTP_PROXY="$OUTBOUND_PROXY" \
    node:20-alpine npx --yes web-push generate-vapid-keys --json 2>/dev/null || true)"
  VAPID_PUBLIC_KEY="$(printf '%s' "$VAPID_JSON" | grep -o '"publicKey":"[^"]*"' | cut -d'"' -f4)"
  VAPID_PRIVATE_KEY="$(printf '%s' "$VAPID_JSON" | grep -o '"privateKey":"[^"]*"' | cut -d'"' -f4)"
  if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
    die "Couldn't generate VAPID keys automatically (docker run node:20-alpine failed?). Run 'npx web-push generate-vapid-keys' yourself and fill VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY into .env manually, then re-run."
  fi
  echo "  ok   VAPID key pair for push notifications"

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

# Unset means "every space on this homeserver the voice bot is invited into", which is what you
# want on a private server. Set it to a comma-separated list of space room IDs to narrow that.
# VOICE_ALLOWED_SPACES=

VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
VAPID_SUBJECT=mailto:$ADMIN_EMAIL

# The homeserver the web client's login screen is locked to (empty: it asks).
PURRLOR_HOMESERVER_URL=$PURRLOR_HOMESERVER_URL

# Outbound HTTP(S) proxy for the services that reach the internet (empty: direct).
OUTBOUND_PROXY=$OUTBOUND_PROXY
OUTBOUND_NO_PROXY=$OUTBOUND_NO_PROXY
ENV_EOF
    if [ "$PROVISION_MATRIX" = true ]; then
      cat <<MATRIX_ENV_EOF

# Bundled homeserver. COMPOSE_PROFILES makes every \`docker compose --env-file .env up\` include it.
COMPOSE_PROFILES=matrix
MATRIX_SERVER_NAME=$MATRIX_SERVER_NAME
MATRIX_REGISTRATION_TOKEN=$MATRIX_REGISTRATION_TOKEN
MATRIX_ALLOW_REGISTRATION=true
# MATRIX_HOMESERVER_URL / MATRIX_BOT_USER_ID / MATRIX_BOT_ACCESS_TOKEN are added below once the
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

cat > /etc/nginx/sites-available/purrlor.conf <<NGINX_EOF
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
  cat >> /etc/nginx/sites-available/purrlor.conf <<MATRIX_NGINX_EOF

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

cat >> /etc/nginx/sites-available/purrlor.conf <<REDIRECT_EOF

server {
    listen 80;
    server_name $REDIRECT_DOMAINS;
    return 301 https://\$host\$request_uri;
}
REDIRECT_EOF

# Earlier versions of this script wrote the same server blocks as nekous.conf, the project's old
# name. Left enabled next to purrlor.conf, every domain would be defined twice. Disabled and kept
# as a .bak rather than deleted, in case it was hand-edited.
if [ -e /etc/nginx/sites-enabled/purrlor.conf ] || [ -e /etc/nginx/sites-available/purrlor.conf ]; then
  rm -f /etc/nginx/sites-enabled/purrlor.conf
  if [ -f /etc/nginx/sites-available/purrlor.conf ]; then
    mv /etc/nginx/sites-available/purrlor.conf /etc/nginx/sites-available/purrlor.conf.bak
  fi
  echo "  ok   retired the old nekous.conf (kept as sites-available/purrlor.conf.bak)"
fi

ln -sf /etc/nginx/sites-available/purrlor.conf /etc/nginx/sites-enabled/purrlor.conf
nginx -t || die "nginx config test failed — check /etc/nginx/sites-available/purrlor.conf"
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

  if [ "$KEEP_ENV" = true ] && [ -n "$(env_get MATRIX_BOT_ACCESS_TOKEN)" ]; then
    BOT_USER_ID="$(env_get MATRIX_BOT_USER_ID)"
    echo "  ok   accounts were created on an earlier run ($BOT_USER_ID is already in .env)"
  else
    if username_taken "$ADMIN_LOCALPART"; then
      echo "  ok   @$ADMIN_LOCALPART:$MATRIX_SERVER_NAME already exists — leaving it (and its password) alone"
    else
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
      if [ -z "$BOOT_TOKEN" ]; then
        # Only printed while the homeserver has no accounts at all — so it already has some (an
        # earlier run's data volume), and the configured token is the one that works now.
        warn "This homeserver already has accounts, so @$ADMIN_LOCALPART is created as a regular
    user, not its admin. The first account ever registered on it is the admin."
        BOOT_TOKEN="$MATRIX_REGISTRATION_TOKEN"
      fi

      log "Creating your admin account (@$ADMIN_LOCALPART:$MATRIX_SERVER_NAME)"
      register_account "$ADMIN_LOCALPART" "$ADMIN_PASSWORD" "$BOOT_TOKEN"
      echo "  ok   $REGISTERED_USER_ID created — this is what you log into Purrlor with"
    fi

    if username_taken "$BOT_LOCALPART"; then
      die "@$BOT_LOCALPART:$MATRIX_SERVER_NAME already exists on this homeserver, but its access token isn't in .env (it was overwritten). Either re-run with a different bot local part, or reset its password from the admin room ('!admin users reset-password $BOT_LOCALPART') and put it in .env as MATRIX_BOT_USERNAME / MATRIX_BOT_PASSWORD."
    fi
    log "Creating the token server's bot account (@$BOT_LOCALPART:$MATRIX_SERVER_NAME)"
    register_account "$BOT_LOCALPART" "$BOT_PASSWORD" "$MATRIX_REGISTRATION_TOKEN"
    BOT_USER_ID="$REGISTERED_USER_ID"
    BOT_ACCESS_TOKEN="$REGISTERED_ACCESS_TOKEN"
    echo "  ok   $BOT_USER_ID created"

    env_set MATRIX_BOT_USER_ID "$BOT_USER_ID"
    env_set MATRIX_BOT_ACCESS_TOKEN "$BOT_ACCESS_TOKEN"
  fi

  # The token server reaches the homeserver over the compose network, not its public URL — no
  # round trip out through nginx (or the outbound proxy) and back in to a service on this host.
  env_set MATRIX_HOMESERVER_URL "http://matrix:8008"

  if [ "$MATRIX_REGISTRATION_MODE" = closed ]; then
    # Takes effect when the `up` below recreates the matrix container with the new value.
    env_set MATRIX_ALLOW_REGISTRATION false
    echo "  ok   registration will be closed once the stack restarts"
  fi
  echo "  ok   .env updated"
fi

log "Building and starting the rest of the Purrlor stack (this can take a few minutes the first time)"
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

HOMESERVER_NOTE=""
if [ "$PROVISION_MATRIX" = true ]; then
  if [ "$MATRIX_REGISTRATION_MODE" = token ]; then
    HOMESERVER_NOTE="
Sign-up on $MATRIX_SERVER_NAME is invite-only. Give this registration token to people you want
to let in — Purrlor's register screen asks for it:
    $MATRIX_REGISTRATION_TOKEN
(it's MATRIX_REGISTRATION_TOKEN in .env; change it there and re-run 'up -d' to revoke it)."
  else
    HOMESERVER_NOTE="
Sign-up on $MATRIX_SERVER_NAME is closed. Create accounts from the admin room in Purrlor
('!admin users create-user <name>'), or set MATRIX_ALLOW_REGISTRATION=true in .env to reopen
it behind the registration token."
  fi
fi
if [ -n "$PURRLOR_HOMESERVER_URL" ]; then
  HOMESERVER_NOTE="$HOMESERVER_NOTE
The web client is locked to $PURRLOR_HOMESERVER_URL (PURRLOR_HOMESERVER_URL in .env)."
fi
if [ -n "$OUTBOUND_PROXY" ]; then
  HOMESERVER_NOTE="$HOMESERVER_NOTE
Outbound traffic goes through $(mask_url "$OUTBOUND_PROXY") (OUTBOUND_PROXY in .env; the Docker
daemon and certbot renewal have their own copies in /etc/systemd/system/*.d/purrlor-proxy.conf)."
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

  1. Open https://$APP_DOMAIN, $LOGIN_LINE, then in the Settings of any
     Space you want voice/video in (Space Settings -> General) set:
       LiveKit URL:      wss://$LIVEKIT_DOMAIN
       Token endpoint:   https://$TOKEN_DOMAIN
     The "Voice service account" field fills itself in with $BOT_USER_ID
     once you leave the token endpoint field - leave it as it lands. Voice channels
     invite that account themselves from then on; you don't have to.

  2. In Account Settings -> Notifications, set the push gateway URL:
       https://$PUSH_DOMAIN
$HOMESERVER_NOTE
$FIREWALL_NOTE
Logs:    docker compose -f deploy/docker-compose.yml logs -f <$LOG_SERVICES>
Update:  $UPDATE_CMD
SUMMARY
