import { RoomType, type IPublicRoomsChunkRoom, type MatrixClient } from 'matrix-js-sdk';

/**
 * Being in a Space means being in its channels — Discord's model. Matrix doesn't do this on its
 * own: joining a Space joins the Space room and nothing else, so every channel inside it sat
 * behind its own Join button. This module joins them for you:
 *
 * - **When you join a Space** (however you got there — an invite, an invite link, Discover),
 *   every channel in it that doesn't need an invite: public ones, and ones restricted to the
 *   Space's members. Text and voice alike; joining a voice channel's *room* doesn't put you in
 *   the call, it just means you're a member when you click it.
 * - **When a channel is added** to a Space you're in.
 *
 * Spaces you were already in before this existed are *not* back-filled automatically: nothing
 * recorded which of their channels you'd deliberately left, so a blanket join could put you back
 * into one. The channel list offers "Join all" for those instead (the same join, on request).
 *
 * Invite-only channels are left alone — they need an invite, which is the point of them — and so
 * is any channel you've **left** (or been removed from). That's remembered in your account data,
 * so auto-join never drags you back into something you walked out of, on any device.
 */

/** Channels you've left, never to be auto-joined again. */
const LEFT_CHANNELS_ACCOUNT_DATA = 'xyz.nekous.left_channels';

const HIERARCHY_PAGE_SIZE = 50;
const MAX_HIERARCHY_PAGES = 20;
const JOIN_CONCURRENCY = 3;

/** Join rules that mean "not without an invite" — anything else is worth trying. */
const NEEDS_INVITE = new Set(['invite', 'knock', 'private']);

/** The SDK types `join_rule` as the few rules it names; the server also sends `restricted` etc. */
export type HierarchyEntry = Omit<IPublicRoomsChunkRoom, 'join_rule'> & { join_rule?: string; allowed_room_ids?: string[] };

function readIdList(mx: MatrixClient, type: string, key: string): string[] {
  const content = mx.getAccountData(type as any)?.getContent<Record<string, unknown>>();
  const list = content?.[key];
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
}

async function writeIdList(mx: MatrixClient, type: string, key: string, ids: string[]): Promise<void> {
  await mx.setAccountData(type as any, { [key]: ids } as any);
}

export function readLeftChannels(mx: MatrixClient): Set<string> {
  return new Set(readIdList(mx, LEFT_CHANNELS_ACCOUNT_DATA, 'roomIds'));
}

/** Records that you left a channel, so auto-join won't put you back. */
export async function rememberLeftChannel(mx: MatrixClient, roomId: string): Promise<void> {
  const left = readLeftChannels(mx);
  if (left.has(roomId)) return;
  await writeIdList(mx, LEFT_CHANNELS_ACCOUNT_DATA, 'roomIds', [...left, roomId]);
}

/** Joining a channel yourself again means you want it — it's auto-joinable again from then on. */
export async function forgetLeftChannel(mx: MatrixClient, roomId: string): Promise<void> {
  const left = readLeftChannels(mx);
  if (!left.delete(roomId)) return;
  await writeIdList(mx, LEFT_CHANNELS_ACCOUNT_DATA, 'roomIds', [...left]);
}

/**
 * Whether a channel from the Space's hierarchy can be joined without an invite. The server only
 * lists channels the viewer could join or see, and omits the join rule for a public one — so a
 * missing rule counts as joinable, and a restricted one is fine when this Space is what grants it.
 */
export function isAutoJoinable(entry: HierarchyEntry, spaceId: string): boolean {
  if (entry.room_type === RoomType.Space) return false; // sub-spaces aren't channels
  const rule = entry.join_rule;
  if (!rule || rule === 'public') return true;
  if (NEEDS_INVITE.has(rule)) return false;
  if (rule === 'restricted' || rule === 'knock_restricted') {
    return !entry.allowed_room_ids || entry.allowed_room_ids.includes(spaceId);
  }
  return false;
}

/** The channels to join: joinable, not already yours (joined or invited), not ones you left. */
export function autoJoinCandidates(
  entries: HierarchyEntry[],
  spaceId: string,
  membershipOf: (roomId: string) => string | undefined,
  left: Set<string>
): string[] {
  return entries
    .filter((entry) => entry.room_id !== spaceId)
    .filter((entry) => isAutoJoinable(entry, spaceId))
    .filter((entry) => {
      const membership = membershipOf(entry.room_id);
      return membership !== 'join' && membership !== 'invite' && membership !== 'ban';
    })
    .filter((entry) => !left.has(entry.room_id))
    .map((entry) => entry.room_id);
}

/** A Space's direct children, as the server describes them (`/hierarchy`, depth 1). */
export async function fetchSpaceChildren(mx: MatrixClient, spaceId: string): Promise<HierarchyEntry[]> {
  const collected: HierarchyEntry[] = [];
  let from: string | undefined;
  for (let page = 0; page < MAX_HIERARCHY_PAGES; page++) {
    const result = await mx.getRoomHierarchy(spaceId, HIERARCHY_PAGE_SIZE, 1, false, from);
    collected.push(...(result.rooms as HierarchyEntry[]).filter((room) => room.room_id !== spaceId));
    if (!result.next_batch) break;
    from = result.next_batch;
  }
  return collected;
}

function serverNameOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? '' : id.slice(colon + 1);
}

async function joinAll(mx: MatrixClient, roomIds: string[], via: string): Promise<string[]> {
  const joined: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < roomIds.length) {
      const roomId = roomIds[next];
      next += 1;
      try {
        await mx.joinRoom(roomId, { viaServers: [serverNameOf(roomId), via].filter(Boolean) });
        joined.push(roomId);
      } catch {
        // One channel that refuses (its rules changed, a server is down) mustn't stop the rest.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOIN_CONCURRENCY, roomIds.length) }, worker));
  return joined;
}

/** One pass at a time per Space: a join and a sync event for it can both ask at once. */
const inFlight = new Map<string, Promise<string[]>>();

/**
 * Joins every channel in the Space you can join without an invite. Channels you've left are
 * skipped, unless `includeLeft` — which is "Join all", a click that asks for exactly that.
 */
export function autoJoinSpaceChannels(
  mx: MatrixClient,
  spaceId: string,
  { includeLeft = false }: { includeLeft?: boolean } = {}
): Promise<string[]> {
  const existing = inFlight.get(spaceId);
  if (existing) return existing;
  const run = (async () => {
    const children = await fetchSpaceChildren(mx, spaceId);
    const candidates = autoJoinCandidates(
      children,
      spaceId,
      (roomId) => mx.getRoom(roomId)?.getMyMembership(),
      includeLeft ? new Set<string>() : readLeftChannels(mx)
    );
    return joinAll(mx, candidates, serverNameOf(spaceId));
  })().finally(() => inFlight.delete(spaceId));
  inFlight.set(spaceId, run);
  return run;
}

/**
 * A channel just added to a Space you're in. Tried directly rather than re-reading the whole
 * hierarchy: a join the server refuses (invite-only) costs one failed request and changes nothing.
 */
export async function autoJoinNewChannel(mx: MatrixClient, spaceId: string, roomId: string): Promise<boolean> {
  const membership = mx.getRoom(roomId)?.getMyMembership();
  if (membership === 'join' || membership === 'invite' || membership === 'ban') return false;
  if (readLeftChannels(mx).has(roomId)) return false;
  const joined = await joinAll(mx, [roomId], serverNameOf(spaceId));
  return joined.length > 0;
}
