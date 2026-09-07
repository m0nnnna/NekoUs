import { EventType, type MatrixClient, type Room } from 'matrix-js-sdk';

/**
 * Discord-style per-server nickname — Matrix has no such concept natively, only a per-*room*
 * displayname override on your own `m.room.member` event (the same mechanism every Matrix client
 * already uses for "change how my name shows up in this one room"). This layers Discord's mental
 * model ("one nickname, every channel in this server") on top of that: setting a Space nickname
 * writes the override to every channel currently joined in it at once, instead of one at a time.
 * The nickname *preference* itself (which Matrix has nowhere public to live outside of a room's
 * own member state) is remembered as private account data purely so it can be re-applied to a
 * channel added *after* the nickname was set — see reconcileSpaceNickname.
 */
const SPACE_NICKNAMES_EVENT = 'xyz.nekous.space_nicknames';

type SpaceNicknamesContent = Record<string, string>;

function readNicknames(mx: MatrixClient): SpaceNicknamesContent {
  return mx.getAccountData(SPACE_NICKNAMES_EVENT as any)?.getContent<SpaceNicknamesContent>() ?? {};
}

export function getSpaceNickname(mx: MatrixClient, spaceId: string): string | undefined {
  return readNicknames(mx)[spaceId];
}

async function applyDisplayNameToRoom(mx: MatrixClient, room: Room, displayName: string): Promise<void> {
  const myUserId = mx.getUserId();
  if (!myUserId) return;
  const existing = room.currentState.getStateEvents(EventType.RoomMember, myUserId)?.getContent() ?? {};
  if (existing.displayname === displayName) return; // already correct — skip a no-op write
  await mx.sendStateEvent(room.roomId, EventType.RoomMember, { ...existing, displayname: displayName } as any, myUserId);
}

export async function setSpaceNickname(mx: MatrixClient, space: Room, childRooms: Room[], nickname: string): Promise<void> {
  const nicknames = readNicknames(mx);
  await mx.setAccountData(SPACE_NICKNAMES_EVENT as any, { ...nicknames, [space.roomId]: nickname } as any);
  await Promise.all(childRooms.map((room) => applyDisplayNameToRoom(mx, room, nickname)));
}

/** Matrix has no "inherit the global name" state to fall back to — clearing a nickname means
 *  explicitly writing your current global displayname into every channel's member event, same as
 *  setting any other nickname would. Fetched fresh via the profile API rather than
 *  `mx.getUser(myUserId)?.displayName`: that field is not actually "your global name" — every
 *  store implementation in matrix-js-sdk shares one `User` object per user ID and overwrites its
 *  `displayName` from *any* room's `m.room.member` event for them (see MemoryStore.onRoomMember,
 *  which IndexedDBStore inherits unchanged), silently, with no event emitted. Once this feature
 *  writes even one per-room nickname override anywhere, that field permanently reflects whichever
 *  room's override was applied most recently — not your account's real display name — so reading
 *  it here would have "cleared" a nickname by reapplying the last nickname value instead. */
export async function clearSpaceNickname(mx: MatrixClient, space: Room, childRooms: Room[]): Promise<void> {
  const nicknames = readNicknames(mx);
  delete nicknames[space.roomId];
  await mx.setAccountData(SPACE_NICKNAMES_EVENT as any, nicknames as any);
  const myUserId = mx.getUserId() ?? '';
  const profile = await mx.getProfileInfo(myUserId).catch(() => undefined);
  const globalName = profile?.displayname ?? myUserId;
  await Promise.all(childRooms.map((room) => applyDisplayNameToRoom(mx, room, globalName)));
}

/** Re-applies a saved nickname to any of the Space's current channels missing it — covers a
 *  channel created/joined after the nickname was originally set, since there's no live "you just
 *  gained a new channel in a space you have a nickname for" event to react to. Called whenever
 *  the nickname settings UI opens (SpaceNicknameSettings.tsx), not on a permanent listener — a
 *  no-op (and cheap: one read, no writes) if this Space has no saved nickname or nothing's
 *  actually out of sync. */
export async function reconcileSpaceNickname(mx: MatrixClient, space: Room, childRooms: Room[]): Promise<void> {
  const nickname = getSpaceNickname(mx, space.roomId);
  if (!nickname) return;
  await Promise.all(childRooms.map((room) => applyDisplayNameToRoom(mx, room, nickname)));
}
