import { EventType, RoomEvent, RoomStateEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';

export type AuditLogEntry = {
  id: string;
  ts: number;
  roomName: string;
  description: string;
};

/**
 * Rooms this doesn't try to derive an audit entry for at all — anything not listed here is noise
 * for a moderation log (message edits, reactions, typing, read receipts, ...).
 */
const RELEVANT_TYPES: Set<string> = new Set([
  EventType.RoomMember,
  EventType.RoomPowerLevels,
  EventType.RoomName,
  EventType.RoomTopic,
  EventType.RoomAvatar,
  EventType.RoomJoinRules,
  EventType.RoomHistoryVisibility,
  EventType.RoomRedaction,
]);

function actorName(room: Room, userId: string): string {
  return room.getMember(userId)?.name || userId;
}

function describeMembership(room: Room, event: MatrixEvent): string | null {
  const actor = actorName(room, event.getSender() ?? '');
  const targetId = event.getStateKey() ?? '';
  const target = actorName(room, targetId);
  const prevMembership = event.getPrevContent().membership as string | undefined;
  const membership = event.getContent().membership as string | undefined;
  if (prevMembership === membership) return null; // a profile-only re-send (e.g. display name change)

  switch (membership) {
    case 'invite':
      return `${actor} invited ${target}`;
    case 'join':
      return `${target} joined`;
    case 'leave':
      if (prevMembership === 'ban') return `${actor} unbanned ${target}`;
      if (prevMembership === 'invite') return `${actor} withdrew ${target}'s invite`;
      if (event.getSender() === targetId) return `${target} left`;
      return `${actor} kicked ${target}`;
    case 'ban':
      return `${actor} banned ${target}`;
    default:
      return null;
  }
}

function describePowerLevels(room: Room, event: MatrixEvent): string[] {
  const actor = actorName(room, event.getSender() ?? '');
  const prevUsers = (event.getPrevContent().users ?? {}) as Record<string, number>;
  const users = (event.getContent().users ?? {}) as Record<string, number>;
  const changedUserIds = [...new Set([...Object.keys(prevUsers), ...Object.keys(users)])].filter(
    (id) => (prevUsers[id] ?? 0) !== (users[id] ?? 0)
  );
  if (changedUserIds.length === 0) return [`${actor} updated room permissions`];
  return changedUserIds.map((id) => `${actor} set ${actorName(room, id)}'s power level to ${users[id] ?? 0}`);
}

/** A single event -> zero or more human-readable audit lines (power-level changes can touch
 *  several users at once, everything else is at most one line). */
function describeEvent(room: Room, event: MatrixEvent): string[] {
  const actor = actorName(room, event.getSender() ?? '');
  switch (event.getType()) {
    case EventType.RoomMember: {
      const line = describeMembership(room, event);
      return line ? [line] : [];
    }
    case EventType.RoomPowerLevels:
      return describePowerLevels(room, event);
    case EventType.RoomName: {
      const name = event.getContent().name;
      return name ? [`${actor} renamed the room to "${name}"`] : [`${actor} removed the room name`];
    }
    case EventType.RoomTopic: {
      const topic = event.getContent().topic;
      return topic ? [`${actor} changed the topic to "${topic}"`] : [`${actor} removed the topic`];
    }
    case EventType.RoomAvatar:
      return [`${actor} changed the room icon`];
    case EventType.RoomJoinRules:
      return [`${actor} set the join rule to "${event.getContent().join_rule}"`];
    case EventType.RoomHistoryVisibility:
      return [`${actor} set history visibility to "${event.getContent().history_visibility}"`];
    case EventType.RoomRedaction:
      return [`${actor} deleted a message`];
    default:
      return [];
  }
}

/**
 * A rolling moderation log for a Space and its channels — derived entirely from state/redaction
 * events already loaded into each room's timeline (no dedicated audit-log endpoint exists in
 * Matrix), so this reflects recent activity rather than a complete historical archive: an event
 * from before the client paginated back that far simply isn't in memory to read. Good enough for
 * "what changed recently," which is what most moderation questions actually are.
 */
export function buildAuditLog(rooms: Room[], limit = 200): AuditLogEntry[] {
  const entries: AuditLogEntry[] = [];
  for (const room of rooms) {
    const seenTimelines = new Set(room.getTimelineSets().flatMap((set) => set.getTimelines()));
    const events = [...seenTimelines].flatMap((timeline) => timeline.getEvents());
    for (const event of events) {
      if (!RELEVANT_TYPES.has(event.getType())) continue;
      for (const description of describeEvent(room, event)) {
        entries.push({ id: `${event.getId()}:${description}`, ts: event.getTs(), roomName: room.name, description });
      }
    }
  }
  entries.sort((a, b) => b.ts - a.ts);
  return entries.slice(0, limit);
}

/** Room-level events this hook needs to re-derive the log on — new timeline events and any
 *  state change (covers redactions arriving via either path depending on client version). */
export const AUDIT_LOG_WATCH_EVENTS = [RoomEvent.Timeline, RoomStateEvent.Events] as const;
