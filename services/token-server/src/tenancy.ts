import { EventType, RoomType, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';

/**
 * Which rooms this deployment will act for at all — the answer to "whose voice server is this?"
 *
 * Without this, the service bot auto-joined every invite it was ever sent and the token endpoint
 * minted a LiveKit token for any room the bot happened to be in. Since `validateOpenIdToken`
 * deliberately accepts a user from *any* federated homeserver (that's the point of the OpenID
 * flow), that combination let anyone on the federation create their own room, invite the bot,
 * and mint themselves a token — with `roomAdmin`, since they're power level 100 in a room they
 * created. Your LiveKit deployment as free media relay, unrelated to any of your Spaces.
 *
 * Two independent gates close that, and both live here so they can't drift apart:
 *
 *  1. **Local rooms only.** A room ID's server half names the homeserver the room was created
 *     on. The bot only ever joins, and only ever authorizes, rooms created on its own.
 *  2. **Children of a Space the bot serves.** A voice channel counts only if a Space the bot has
 *     joined lists it in `m.space.child`. That direction matters: `m.space.parent` is set by the
 *     *child* room, so anyone can point their own room at your Space and claim to belong to it —
 *     `m.space.child` is set by the Space, which is state only the Space's own admins can write.
 *
 * Which Spaces the bot serves is `VOICE_ALLOWED_SPACES` when set, and otherwise every Space it
 * has been invited into — see `servedSpaceIds`.
 */

/** The server-name half of a Matrix ID (`@user:server`, `!room:server`, ports included). */
export function serverNameOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? '' : id.slice(colon + 1);
}

/**
 * Explicit allowlist of Space room IDs. Unset (the default) means "every Space the bot is in",
 * which is the right policy for a single-tenant self-hosted deployment: the homeserver's own
 * registration settings are already the gate on who can create a Space there. Set it on a
 * deployment with open registration, or one whose LiveKit capacity is meant for specific Spaces.
 */
function configuredSpaceAllowlist(): Set<string> | undefined {
  const raw = process.env.VOICE_ALLOWED_SPACES;
  if (!raw) return undefined;
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : undefined;
}

/** Matches `readVoiceServerConfig`'s own cap in the web client, which walks the same tree upwards. */
const MAX_SPACE_DEPTH = 5;

/**
 * An `m.space.child` with no `via` is how Matrix spells "no longer a child" — there is no state
 * event deletion, so an emptied content is the removal.
 */
function linksChild(content: unknown): boolean {
  const via = (content as { via?: unknown } | undefined)?.via;
  return Array.isArray(via) && via.length > 0;
}

function joinedLocalSpaces(mx: MatrixClient): Map<string, Room> {
  const localServer = serverNameOf(mx.getUserId() ?? '');
  const spaces = new Map<string, Room>();
  for (const room of mx.getRooms()) {
    if (room.getMyMembership() !== 'join') continue;
    if (!room.isSpaceRoom()) continue;
    if (serverNameOf(room.roomId) !== localServer) continue;
    spaces.set(room.roomId, room);
  }
  return spaces;
}

function childSpaceIds(space: Room, candidates: Map<string, Room>): string[] {
  const events = space.currentState.getStateEvents(EventType.SpaceChild) as MatrixEvent[];
  return events
    .filter((event) => linksChild(event.getContent()))
    .map((event) => event.getStateKey())
    .filter((roomId): roomId is string => Boolean(roomId) && candidates.has(roomId as string));
}

/**
 * The Spaces whose voice channels this deployment authorizes. With no allowlist configured
 * that's every Space the bot has joined; with one, it's the configured roots plus any sub-space
 * of them the bot has also joined (a sub-space inherits its parent's voice server in the client,
 * so it has to inherit the same trust here or nested Spaces would silently lose voice).
 */
export function servedSpaceIds(mx: MatrixClient): Set<string> {
  const joined = joinedLocalSpaces(mx);
  const allowlist = configuredSpaceAllowlist();
  if (!allowlist) return new Set(joined.keys());

  const served = new Set<string>();
  let frontier = [...allowlist].filter((roomId) => joined.has(roomId));
  for (let depth = 0; depth <= MAX_SPACE_DEPTH && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const roomId of frontier) {
      if (served.has(roomId)) continue;
      served.add(roomId);
      for (const childId of childSpaceIds(joined.get(roomId)!, joined)) {
        if (!served.has(childId)) next.push(childId);
      }
    }
    frontier = next;
  }
  return served;
}

/**
 * Whether a served Space lists this room as one of its children.
 *
 * Checks the bot's synced copy of each Space's state first, then falls back to asking the
 * homeserver directly. That fallback exists for one specific moment: creating a channel writes
 * the room first and its `m.space.child` link a round trip later (`roomCreation.ts`), so a
 * caller who connects immediately can legitimately arrive before the bot has synced the link.
 * The state key is the room ID, so this is a single point lookup per Space rather than a scan.
 *
 * It only runs for a room the bot already knows about (one it has been invited to or joined),
 * which is deliberate: `roomId` reaches here off a caller's request body, and a fallback that
 * ran for any string would turn one unauthenticated request into one homeserver round trip per
 * served Space. A room the bot knows nothing about is decided on synced state alone — and the
 * client retries a not-yet-authorized channel for ~12s, which is far longer than that state
 * takes to arrive.
 */
async function isChildOfServedSpace(mx: MatrixClient, roomId: string): Promise<boolean> {
  const spaceIds = [...servedSpaceIds(mx)];
  if (!spaceIds.length) return false;

  for (const spaceId of spaceIds) {
    const event = mx.getRoom(spaceId)?.currentState.getStateEvents(EventType.SpaceChild, roomId);
    if (event && linksChild(event.getContent())) return true;
  }

  if (!mx.getRoom(roomId)) return false;

  for (const spaceId of spaceIds) {
    const content = await mx.getStateEvent(spaceId, EventType.SpaceChild, roomId).catch(() => undefined);
    if (linksChild(content)) return true;
  }
  return false;
}

/**
 * Whether this deployment will mint tokens for a room: local, and a child of a Space it serves.
 * Checked on every token request rather than only at join time, so a room the bot was walked
 * into before this gate existed — or one that has since been unlinked from its Space — stops
 * being authorized without anyone having to go and kick the bot out of it.
 */
export async function isRoomServed(mx: MatrixClient, roomId: string): Promise<boolean> {
  if (serverNameOf(roomId) !== serverNameOf(mx.getUserId() ?? '')) return false;
  return isChildOfServedSpace(mx, roomId);
}

/**
 * Whether the bot should accept a pending invite. Anyone can send an invite, so this is what
 * decides which ones mean anything.
 *
 * A Space invite is the bootstrapping case — it's how the bot gets the anchor every other check
 * hangs off, and it's deliberately the only thing accepted without one already existing. It's
 * gated on `VOICE_ALLOWED_SPACES` where that's configured, and on the homeserver's own
 * registration policy where it isn't. Space Settings sends this invite when voice is configured
 * (`SpaceGeneralSettings.tsx`), so it isn't a step anyone has to know to take.
 *
 * Everything else has to be a room a served Space claims as its own.
 */
export async function mayAcceptInvite(mx: MatrixClient, roomId: string): Promise<boolean> {
  if (serverNameOf(roomId) !== serverNameOf(mx.getUserId() ?? '')) return false;

  // Invite state carries `m.room.create` (it's in the spec's stripped-state set), so a Space
  // invite is recognizable as one before joining it.
  const invited = mx.getRoom(roomId);
  if (invited?.getType() === RoomType.Space) {
    const allowlist = configuredSpaceAllowlist();
    if (!allowlist) return true;
    if (allowlist.has(roomId)) return true;
    // A sub-space of one we already serve: the same inheritance servedSpaceIds walks.
    return isChildOfServedSpace(mx, roomId);
  }

  return isChildOfServedSpace(mx, roomId);
}

/**
 * The key the web client puts on a voice channel's `m.space.child` link (apps/web/src/matrix/
 * channelType.ts, SPACE_CHILD_CHANNEL_TYPE_KEY). A channel's own state can only be read from
 * inside it; the Space's links can be read by anyone in the Space — so this is how the bot tells a
 * voice channel from a text one *before* joining, and joins only the voice ones.
 */
export const SPACE_CHILD_CHANNEL_TYPE_KEY = 'xyz.nekous.channel_type';

/**
 * Every voice channel the bot should be in: linked as a child of a Space it serves, marked
 * voice on that link, and created on the bot's own homeserver (the same "local rooms only" gate
 * as everything else here). Text channels are deliberately never included — the bot only answers
 * "may this person join the call?", and being in a text channel would hand it every message.
 */
export function servedVoiceChannelIds(mx: MatrixClient): string[] {
  const localServer = serverNameOf(mx.getUserId() ?? '');
  const ids = new Set<string>();
  for (const spaceId of servedSpaceIds(mx)) {
    const events = (mx.getRoom(spaceId)?.currentState.getStateEvents(EventType.SpaceChild) ?? []) as MatrixEvent[];
    for (const event of events) {
      const roomId = event.getStateKey();
      const content = event.getContent() as Record<string, unknown>;
      if (!roomId || !linksChild(content)) continue;
      if (content[SPACE_CHILD_CHANNEL_TYPE_KEY] !== 'voice') continue;
      if (serverNameOf(roomId) !== localServer) continue;
      ids.add(roomId);
    }
  }
  return [...ids];
}
