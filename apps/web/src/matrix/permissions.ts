import { EventType, type MatrixEvent, type Room } from 'matrix-js-sdk';

type PowerLevelsContent = {
  users?: Record<string, number>;
  users_default?: number;
  events?: Record<string, number>;
  state_default?: number;
  redact?: number;
  invite?: number;
  kick?: number;
  ban?: number;
  notifications?: { room?: number };
};

function getPowerLevelsContent(room: Room): PowerLevelsContent {
  return room.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent<PowerLevelsContent>() ?? {};
}

function getUserPowerLevel(content: PowerLevelsContent, userId: string): number {
  return content.users?.[userId] ?? content.users_default ?? 0;
}

/**
 * Reads `m.room.power_levels` and checks whether a user is allowed to send a given state event
 * type in this room — the same mechanism Matrix uses to gate renaming, changing the topic/
 * avatar, and so on. Falls back to the spec defaults (`state_default: 50`, `users_default: 0`)
 * when a room hasn't customized them.
 */
export function canSendStateEvent(room: Room, userId: string, eventType: string): boolean {
  const content = getPowerLevelsContent(room);
  const requiredLevel = content.events?.[eventType] ?? content.state_default ?? 50;
  return getUserPowerLevel(content, userId) >= requiredLevel;
}

/**
 * Per the spec, redaction is always allowed on your own events regardless of power level (the
 * same rule every Matrix client follows for "delete my own message") — otherwise it takes the
 * room's dedicated `redact` power level (default 50), separate from `state_default`.
 */
export function canRedactEvent(room: Room, userId: string, event: MatrixEvent): boolean {
  if (event.getSender() === userId) return true;
  const content = getPowerLevelsContent(room);
  return getUserPowerLevel(content, userId) >= (content.redact ?? 50);
}

/** Matrix's own default for `invite` is 0 — any joined member can invite unless a room has
 *  deliberately locked it down, unlike kick/ban which default to moderator level (50). */
export function canInviteToRoom(room: Room, userId: string): boolean {
  const content = getPowerLevelsContent(room);
  return getUserPowerLevel(content, userId) >= (content.invite ?? 0);
}

export function canKickFromRoom(room: Room, userId: string, targetPowerLevel: number): boolean {
  const content = getPowerLevelsContent(room);
  const myLevel = getUserPowerLevel(content, userId);
  return myLevel >= (content.kick ?? 50) && myLevel > targetPowerLevel;
}

export function canBanFromRoom(room: Room, userId: string, targetPowerLevel: number): boolean {
  const content = getPowerLevelsContent(room);
  const myLevel = getUserPowerLevel(content, userId);
  return myLevel >= (content.ban ?? 50) && myLevel > targetPowerLevel;
}

/** Whether this user could ban *someone* here, without a specific target to compare against —
 *  used to decide whether the banned-users list (with its Unban action) is worth showing at all. */
export function canManageBans(room: Room, userId: string): boolean {
  const content = getPowerLevelsContent(room);
  return getUserPowerLevel(content, userId) >= (content.ban ?? 50);
}

/** The `@room` mass-mention (Discord's `@everyone`) — spec default requires power level 50,
 *  same as kick/ban, not the much lower `state_default`/`users_default` a plain message needs. */
export function canMentionRoom(room: Room, userId: string): boolean {
  const content = getPowerLevelsContent(room);
  return getUserPowerLevel(content, userId) >= (content.notifications?.room ?? 50);
}
