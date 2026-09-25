import { EventType, type MatrixClient, type Room } from 'matrix-js-sdk';
import { markLeavingSpace } from './autoJoin';
import { listSpaceFeeds } from './feed';
import { roomAdmins } from './permissions';

/**
 * Leaving a Space the way Discord leaves a server: the Space, its channels, and the other members'
 * feed rooms you joined to read its Posts page.
 *
 * - **Your own feed room stays.** You're its only admin, and keeping it (it's recorded in your
 *   account data, feed.ts) means rejoining the Space later picks up your old posts again. Leaving
 *   the Space already takes them out of every view of it, since only joined members' feeds count.
 * - **A channel that's also in another Space you're in stays**, since you haven't left that one.
 * - **Sub-spaces are left alone.** Being in one is its own membership, not a channel.
 * - Leaving the Space doesn't mark its channels as "left on purpose" (autoJoin.ts), so rejoining
 *   the Space joins them again.
 *
 * The Space goes first: if something fails partway, you're out of the Space, and what's left is a
 * few rooms you can still leave by hand, rather than half-in with no way to tell.
 */
export async function leaveSpace(mx: MatrixClient, space: Room): Promise<{ failed: number }> {
  const myUserId = mx.getUserId() ?? '';
  const children = spaceChildIds(space);
  const feeds = listSpaceFeeds(space)
    .filter(({ userId }) => userId !== myUserId)
    .map(({ roomId }) => roomId);

  markLeavingSpace(space.roomId);
  await mx.leave(space.roomId);

  const otherSpaces = mx
    .getRooms()
    .filter((room) => room.isSpaceRoom() && room.roomId !== space.roomId && room.getMyMembership() === 'join');
  const toLeave = [...new Set([...children, ...feeds])].filter((roomId) => {
    const room = mx.getRoom(roomId);
    if (!room || room.getMyMembership() !== 'join' || room.isSpaceRoom()) return false;
    return !otherSpaces.some((other) => spaceChildIds(other).includes(roomId));
  });

  let failed = 0;
  // One at a time: a big Space shouldn't fire a burst of leaves into the rate limiter.
  for (const roomId of toLeave) {
    await mx.leave(roomId).catch(() => {
      failed += 1;
    });
  }
  return { failed };
}

/** The rooms a Space lists as children (a removed child has an empty `via`). */
function spaceChildIds(space: Room): string[] {
  return space.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((event) => Array.isArray(event.getContent().via) && event.getContent().via.length > 0)
    .map((event) => event.getStateKey())
    .filter((id): id is string => !!id);
}

/**
 * Whether you're the only one who can manage this Space and others would be left behind — worth a
 * warning, since nobody could then rename it, moderate it, or hand out admin again.
 */
export function wouldOrphanSpace(space: Room, myUserId: string): boolean {
  const admins = roomAdmins(space);
  const othersJoined = space.getJoinedMembers().some((member) => member.userId !== myUserId);
  return othersJoined && admins.length === 1 && admins[0] === myUserId;
}
