import { DEMO_BOT_USER_ID, DEMO_TOKEN_ORIGIN } from './demoMode';

/**
 * A stand-in for services/token-server, installed as a `fetch` interceptor for the demo's token
 * origin only — every other URL falls through to the real `fetch` untouched.
 *
 * The point is that `useVoiceConnection` and `matrix/voiceBot.ts` run **unmodified** in demo
 * mode: they really do look up the bot, really do invite it, really do get a 409 back and retry,
 * and really do fall through to the error UI. Demo mode fakes the server, not the client logic,
 * so what's on screen is the actual state machine rather than a mock-up of it.
 *
 * What it deliberately never does is hand back a usable LiveKit token. A token would send
 * `<LiveKitRoom>` off to open a real WebRTC connection to a host that doesn't exist, which fails
 * noisily and teaches nothing — so the in-call UI (participant grid, control bar, Watch
 * Together) is out of demo mode's scope and needs a real LiveKit deployment. Everything up to
 * that point is exercised honestly.
 */

/** Who the fake LiveKit reports as sitting in a voice channel, for the channel list's occupancy row. */
const DEMO_OCCUPANTS: Record<string, { identity: string; micMuted: boolean; deafened: boolean }[]> = {};

export function setDemoOccupants(
  roomId: string,
  occupants: { identity: string; micMuted: boolean; deafened: boolean }[]
): void {
  DEMO_OCCUPANTS[roomId] = occupants;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Mirrors the real endpoints' shapes exactly (services/token-server/src/server.ts) — including
 * the 409 `voice_bot_not_in_room` the client self-heals from, which is the whole reason a demo
 * voice channel without the bot behaves like the real thing.
 */
async function handle(url: URL, init: RequestInit | undefined, isBotInRoom: (roomId: string) => boolean) {
  if (url.pathname === '/api/livekit/config') {
    return json({ botUserId: DEMO_BOT_USER_ID });
  }

  if (url.pathname === '/api/livekit/rooms/participants') {
    // Same shape as the real server: POST with an OpenID token and the room IDs to ask about.
    if (init?.method !== 'POST') return json({ error: 'Participants require authentication', code: 'auth_required' }, 401);
    const body = JSON.parse(String(init.body ?? '{}')) as { openid_token?: unknown; room_ids?: unknown };
    if (!body.openid_token) return json({ error: 'Authentication failed' }, 401);
    const roomIds = Array.isArray(body.room_ids) ? body.room_ids.filter((id): id is string => typeof id === 'string') : [];
    const result: Record<string, unknown[]> = {};
    roomIds.forEach((roomId) => {
      result[roomId] = DEMO_OCCUPANTS[roomId] ?? [];
    });
    return json(result);
  }

  if (url.pathname === '/api/livekit/token') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { room_id?: string };
    const roomId = body.room_id ?? '';

    if (!isBotInRoom(roomId)) {
      return json(
        {
          error: 'The voice service bot has not been invited to this channel yet',
          code: 'voice_bot_not_in_room',
          botUserId: DEMO_BOT_USER_ID,
        },
        409
      );
    }

    // Bot present, caller is a member — the real server would mint a token here. Demo mode
    // stops short on purpose (see the module comment) and says so in the UI.
    return json(
      {
        error:
          'Demo mode has no LiveKit server to connect to — everything up to this point is the real join flow.',
        code: 'demo_no_livekit',
      },
      503
    );
  }

  return json({ error: 'Not found' }, 404);
}

/**
 * Installs the interceptor. `isBotInRoom` is supplied by the caller rather than read here, so
 * this module stays ignorant of the fake client and answers from the same room state the UI is
 * looking at — invite the bot in the app and the next token request genuinely succeeds past the
 * membership check.
 */
export function installDemoTokenServer(isBotInRoom: (roomId: string) => boolean): void {
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith(DEMO_TOKEN_ORIGIN)) {
      return realFetch(input as RequestInfo, init);
    }
    return handle(new URL(href), init, isBotInRoom);
  };
}
