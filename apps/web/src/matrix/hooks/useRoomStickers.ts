import { useEffect, useState } from 'react';
import { RoomStateEvent, type Room } from 'matrix-js-sdk';
import { findParentSpaceId } from '../spaceChildren';
import { useMatrixClient } from '../MatrixClientContext';
import { getRoomStickers, type Sticker } from '../emotes';

/** Same channel-pack-merged-with-parent-Space-pack treatment as useRoomEmotes.ts — see its
 *  comment for why. */
function computeStickers(mx: ReturnType<typeof useMatrixClient>, room: Room): Sticker[] {
  const parentSpaceId = findParentSpaceId(mx, room.roomId);
  const space = parentSpaceId ? mx.getRoom(parentSpaceId) : undefined;
  const merged = new Map<string, Sticker>();
  if (space) getRoomStickers(space).forEach((s) => merged.set(s.shortcode, s));
  getRoomStickers(room).forEach((s) => merged.set(s.shortcode, s));
  return [...merged.values()];
}

export function useRoomStickers(room: Room | undefined): Sticker[] {
  const mx = useMatrixClient();
  const [stickers, setStickers] = useState<Sticker[]>(() => (room ? computeStickers(mx, room) : []));

  useEffect(() => {
    if (!room) {
      setStickers([]);
      return undefined;
    }

    const parentSpaceId = findParentSpaceId(mx, room.roomId);
    const space = parentSpaceId ? mx.getRoom(parentSpaceId) : undefined;
    const update = () => setStickers(computeStickers(mx, room));
    update();

    room.on(RoomStateEvent.Events, update);
    space?.on(RoomStateEvent.Events, update);
    return () => {
      room.removeListener(RoomStateEvent.Events, update);
      space?.removeListener(RoomStateEvent.Events, update);
    };
  }, [mx, room]);

  return stickers;
}
