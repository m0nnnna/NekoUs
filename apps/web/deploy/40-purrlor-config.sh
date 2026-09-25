#!/bin/sh
# Writes the web client's per-deployment config (apps/web/src/app/runtimeConfig.ts) from this
# container's environment. The nginx image runs every executable /docker-entrypoint.d/*.sh before
# starting nginx, so this happens on each container start — changing PURRLOR_HOMESERVER_URL in
# .env and recreating the container is enough, no image rebuild.
#
# PURRLOR_HOMESERVER_URL unset or empty writes {"homeserver":""}, which the client reads as "not
# locked": the login screen asks for a homeserver as it always has.
set -eu

# Escape the two characters that could break out of a JSON string. Everything else a homeserver
# URL or server name can contain is fine as-is.
homeserver="$(printf '%s' "${PURRLOR_HOMESERVER_URL:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')"

printf '{"homeserver":"%s"}\n' "$homeserver" > /usr/share/nginx/html/config.json
echo "purrlor: wrote config.json (homeserver: ${PURRLOR_HOMESERVER_URL:-<not locked>})"
