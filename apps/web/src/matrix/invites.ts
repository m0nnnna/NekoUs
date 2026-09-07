import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getParentSpace } from './voice';

export type InviteKind = 'space' | 'channel' | 'dm';

/**
 * Classifies a pending invite the same three-way way the rest of the app already sorts rooms
 * (server rail = Spaces, channel list children = channels, spaceless list = everything else) —
 * so an invite reads the same regardless of whether you've joined it yet. `getParentSpace` reads
 * `m.space.parent`, which a well-behaved inviting homeserver includes in the limited
 * `invite_room_state` it sends alongside the invite specifically so clients can show this before
 * joining; a homeserver that omits it just means a channel invite falls back to showing as a
 * plain "Direct Message"-kind row instead — same honest degrade as everywhere else here that
 * depends on state a server chooses whether to hand over.
 */
export function classifyInvite(mx: MatrixClient, room: Room): InviteKind {
  if (room.isSpaceRoom()) return 'space';
  return getParentSpace(mx, room) ? 'channel' : 'dm';
}

export async function acceptInvite(mx: MatrixClient, roomId: string): Promise<void> {
  await mx.joinRoom(roomId);
}

/** Matrix has one endpoint for both "leave a room you're in" and "reject an invite you haven't
 *  joined" — `/rooms/{roomId}/leave` — there's no separate decline call. */
export async function declineInvite(mx: MatrixClient, roomId: string): Promise<void> {
  await mx.leave(roomId);
}
