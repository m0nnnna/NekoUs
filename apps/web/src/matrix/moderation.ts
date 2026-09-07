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

export async function inviteMember(mx: MatrixClient, roomId: string, userId: string): Promise<void> {
  await mx.invite(roomId, userId);
}
