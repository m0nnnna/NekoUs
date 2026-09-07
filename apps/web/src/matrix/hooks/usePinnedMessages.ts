import { useEffect, useState } from 'react';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { usePinnedEventIds } from './usePinnedEventIds';

async function resolveEvent(
  mx: ReturnType<typeof useMatrixClient>,
  room: Room,
  eventId: string
): Promise<MatrixEvent | null> {
  const local = room.findEventById(eventId);
  if (local) return local;
  // Pinned messages older than what's currently loaded aren't in the timeline — fetch them
  // directly, decrypting on demand since fetchRoomEvent returns raw (still-encrypted) content.
  try {
    const raw = await mx.fetchRoomEvent(room.roomId, eventId);
    const event = new MatrixEvent(raw);
    await mx.decryptEventIfNeeded(event);
    return event;
  } catch {
    return null;
  }
}

/** Resolves pinned event IDs into actual (decrypted) MatrixEvent objects. */
export function usePinnedMessages(roomId: string | null): MatrixEvent[] {
  const mx = useMatrixClient();
  const pinnedIds = usePinnedEventIds(roomId);
  const [events, setEvents] = useState<MatrixEvent[]>([]);
  const pinnedIdsKey = pinnedIds.join(',');

  useEffect(() => {
    const room = roomId ? mx.getRoom(roomId) : null;
    if (!room || pinnedIds.length === 0) {
      setEvents([]);
      return undefined;
    }
    let cancelled = false;
    Promise.all(pinnedIds.map((id) => resolveEvent(mx, room, id))).then((resolved) => {
      if (!cancelled) setEvents(resolved.filter((event): event is MatrixEvent => event !== null));
    });
    return () => {
      cancelled = true;
    };
    // pinnedIdsKey stands in for pinnedIds so this only re-resolves when the pinned set's
    // *contents* change, not on every re-render of a new-but-equal array from the hook above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, roomId, pinnedIdsKey]);

  return events;
}
