# Builds the NekoUs web client into a static bundle and serves it with nginx.
#
# No runtime config injection (unlike cinny-voice's Dockerfile.voice, which baked a single
# global LiveKit URL/token endpoint into the served page): NekoUs discovers voice server config
# per-Space from Matrix room state (xyz.nekous.voice_server, see docs/voice-architecture.md),
# and the homeserver is whatever URL the user enters at login — this same built bundle can be
# pointed at any homeserver, or serve multiple Spaces each with their own LiveKit deployment,
# without a rebuild or per-deployment env vars.

FROM node:24-alpine AS builder
WORKDIR /src

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web ./
ENV NODE_OPTIONS=--max_old_space_size=4096
RUN npm run build


FROM nginx:1.25-alpine
COPY --from=builder /src/dist /usr/share/nginx/html
COPY apps/web/deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
