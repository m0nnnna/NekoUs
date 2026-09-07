import { useEffect, useState } from 'react';
import { RoomEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

/** Basic room metadata (currently just re-renders on name changes). */
export function useRoom(roomId: string | null): Room | undefined {
  const mx = useMatrixClient();
  const [, forceRender] = useState(0);
  const room = roomId ? (mx.getRoom(roomId) ?? undefined) : undefined;

  useEffect(() => {
    if (!room) return undefined;
    const onName = () => forceRender((n) => n + 1);
    room.on(RoomEvent.Name, onName);
    return () => {
      room.removeListener(RoomEvent.Name, onName);
    };
  }, [room]);

  return room;
}
