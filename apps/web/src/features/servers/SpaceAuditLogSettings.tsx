import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useSpaceRooms } from '../../matrix/hooks/useSpaceRooms';
import { AUDIT_LOG_WATCH_EVENTS, buildAuditLog, type AuditLogEntry } from '../../matrix/auditLog';
import './SpaceAuditLogSettings.css';

function useAuditLog(space: Room): AuditLogEntry[] {
  const channels = useSpaceRooms(space.roomId);
  const rooms = [space, ...channels];
  const [entries, setEntries] = useState<AuditLogEntry[]>(() => buildAuditLog(rooms));

  // Re-derive whenever the channel list itself changes (join/leave a channel) — the join array
  // below covers room-membership within the effect re-running when the actual set of rooms does.
  const roomIdsKey = rooms.map((r) => r.roomId).join(',');

  useEffect(() => {
    const update = () => setEntries(buildAuditLog(rooms));
    update();
    for (const room of rooms) {
      for (const eventName of AUDIT_LOG_WATCH_EVENTS) {
        room.on(eventName, update);
      }
    }
    return () => {
      for (const room of rooms) {
        for (const eventName of AUDIT_LOG_WATCH_EVENTS) {
          room.removeListener(eventName, update);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomIdsKey]);

  return entries;
}

/** A rolling moderation log across a Space and its channels — see matrix/auditLog.ts for exactly
 *  what it does and doesn't cover (recent, in-memory history, not a complete archive). */
export function SpaceAuditLogSettings({ space }: { space: Room }) {
  const entries = useAuditLog(space);

  if (entries.length === 0) {
    return (
      <p className="nu-space-audit-log__empty" data-nu-role="space-audit-log-empty">
        No moderation activity in recent history.
      </p>
    );
  }

  return (
    <div className="nu-space-audit-log__list" data-nu-role="space-audit-log-list">
      {entries.map((entry) => (
        <div className="nu-space-audit-log__item" data-nu-role="space-audit-log-item" key={entry.id}>
          <span className="nu-space-audit-log__item-desc">{entry.description}</span>
          <span className="nu-space-audit-log__item-meta">
            {entry.roomName} · {new Date(entry.ts).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
