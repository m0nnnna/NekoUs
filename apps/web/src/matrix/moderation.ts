import type { MatrixClient } from 'matrix-js-sdk';

export async function kickMember(mx: MatrixClient, roomId: string, userId: string, reason?: string): Promise<void> {
  await mx.kick(roomId, userId, reason || undefined);
}

export async function banMember(mx: MatrixClient, roomId: string, userId: string, reason?: string): Promise<void> {
  await mx.ban(roomId, userId, reason || undefined);
}

export async function unbanMember(mx: MatrixClient, roomId: string, userId: string): Promise<void> {
  await mx.unban(roomId, userId);
}

/**
 * Reports an event to the homeserver's admins (`POST /rooms/{roomId}/report/{eventId}`). Where it
 * lands is the server's business — Synapse keeps a queue for its admin API, Continuwuity posts it
 * to the admin room. The score is the spec's deprecated "how bad", sent as the worst for servers
 * that still expect one.
 *
 * Continuwuity refuses a report from someone who isn't in the room ("You are not in the room you
 * are reporting", checked live), and a post is often read from a feed you haven't joined, so this
 * joins first, through `viaServers` (the feed owner's server; feedJoinVia).
 */
export async function reportContent(
  mx: MatrixClient,
  roomId: string,
  eventId: string,
  reason: string,
  viaServers: string[] = []
): Promise<void> {
  if (mx.getRoom(roomId)?.getMyMembership() !== 'join') {
    await mx.joinRoom(roomId, { viaServers });
  }
  await mx.reportEvent(roomId, eventId, -100, reason);
}

export async function inviteMember(mx: MatrixClient, roomId: string, userId: string): Promise<void> {
  await mx.invite(roomId, userId);
}
