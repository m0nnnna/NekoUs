import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { validateOpenIdToken } from './openid.js';
import { checkMembership } from './membership.js';
import { grantsForPowerLevel } from './grants.js';
import { livekitRoomName } from './livekitRoomName.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
// Server-to-server LiveKit API host (RoomServiceClient), distinct from the wss:// URL clients
// use — same LiveKit deployment, just its plain HTTP endpoint reached over the docker network.
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? 'http://livekit:7880';

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
  process.exit(1);
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim());

function corsOriginAllowed(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
    callback(null, true);
    return;
  }
  // Support a single leading-wildcard subdomain pattern, e.g. https://*.example.com — same
  // convention as cinny-voice's token server.
  const matched = ALLOWED_ORIGINS.some((allowed) => {
    if (!allowed.includes('*')) return false;
    const pattern = `^${allowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*')}$`;
    return new RegExp(pattern).test(origin);
  });
  callback(null, matched);
}

const app = express();
app.use(cors({ origin: corsOriginAllowed }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nekous-token-server' });
});

app.post('/api/livekit/token', async (req, res) => {
  const openIdToken = req.body?.openid_token;
  const roomId = req.body?.room_id;
  if (!openIdToken || !roomId) {
    res.status(400).json({ error: 'openid_token and room_id are required' });
    return;
  }

  try {
    const userId = await validateOpenIdToken(openIdToken);
    const membership = await checkMembership(userId, roomId);
    if (!membership.isMember) {
      res.status(403).json({ error: 'Not a member of this room' });
      return;
    }

    const roomName = livekitRoomName(roomId);
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: userId,
      name: userId,
      ttl: '24h',
    });
    at.addGrant({ room: roomName, roomJoin: true, ...grantsForPowerLevel(membership.powerLevel) });

    const token = await at.toJwt();
    res.json({ token, roomName });
  } catch (err) {
    console.error('Failed to mint token', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// Live participant tracking — queried on demand from LiveKit itself (RoomServiceClient) rather
// than cached from webhooks, so it's always current and can report per-participant mic/deafen
// state (which webhooks can't: LiveKit doesn't send a webhook when a track's mute state changes
// after publish, only on publish/unpublish — a client that reliably needs before-and-after mute
// state on every toggle would need webhooks anyway, but "what's true right now" is simpler and
// more reliable to just ask for than to keep a hand-rolled cache in sync).
const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

type VoiceParticipant = { identity: string; micMuted: boolean; deafened: boolean };

app.get('/api/livekit/rooms/participants', async (req, res) => {
  const roomIdsParam = req.query.roomIds;
  const roomIds = typeof roomIdsParam === 'string' ? roomIdsParam.split(',').filter(Boolean) : [];
  const result: Record<string, VoiceParticipant[]> = {};

  await Promise.all(
    roomIds.map(async (roomId) => {
      try {
        const participants = await roomService.listParticipants(livekitRoomName(roomId));
        result[roomId] = participants.map((p) => {
          const micTrack = p.tracks.find((t) => t.source === TrackSource.MICROPHONE);
          return {
            identity: p.identity,
            micMuted: micTrack?.muted ?? true,
            // Broadcast by the client itself via localParticipant.setAttributes — LiveKit has
            // no built-in "deafened" concept (muting your own playback of others isn't
            // something the server can see), see VoiceChannelPanel.tsx's toggleDeafen.
            deafened: p.attributes.deafened === 'true',
          };
        });
      } catch {
        result[roomId] = []; // No LiveKit room yet (nobody's joined) — not an error.
      }
    })
  );

  res.json(result);
});

app.listen(PORT, () => {
  console.log(`nekous-token-server listening on :${PORT}`);
});
