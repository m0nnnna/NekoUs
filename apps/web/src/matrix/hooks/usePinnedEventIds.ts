import { useEffect, useState } from 'react';
import { EventType, RoomStateEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

/** Raw `m.room.pinned_events` contents for a room — just the event IDs, oldest-pinned first. */
export function usePinnedEventIds(roomId: string | null): string[] {
  const mx = useMatrixClient();
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (!roomId) {
      setIds([]);
      return undefined;
    }
    const room = mx.getRoom(roomId);
    if (!room) {
      setIds([]);
      return undefined;
    }

    const update = () => {
      const content = room.currentState
        .getStateEvents(EventType.RoomPinnedEvents, '')
        ?.getContent<{ pinned?: string[] }>();
      setIds(content?.pinned ?? []);
    };
    update();

    room.on(RoomStateEvent.Events, update);
    return () => {
      room.removeListener(RoomStateEvent.Events, update);
    };
  }, [mx, roomId]);

  return ids;
}
