import { useEffect, useState } from 'react';
import { RoomStateEvent, type RoomMember } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

/**
 * Joined members of a room, including their current power level. Triggers
 * `loadMembersIfNeeded()` since the client is started with `lazyLoadMembers: true` (Phase 0) —
 * without this, member state simply isn't fetched until something asks for it. Listens broadly
 * to `RoomStateEvent.Events` (not just `.Members`) since a power-level change comes from
 * `m.room.power_levels`, a different state event than `m.room.member` — narrowing to just
 * `.Members` would miss a promotion/demotion.
 */
export function useRoomMembers(roomId: string | null): RoomMember[] {
  const mx = useMatrixClient();
  const [members, setMembers] = useState<RoomMember[]>([]);

  useEffect(() => {
    if (!roomId) {
      setMembers([]);
      return undefined;
    }
    const room = mx.getRoom(roomId);
    if (!room) {
      setMembers([]);
      return undefined;
    }

    const update = () => setMembers([...room.getJoinedMembers()]);
    update();
    room.loadMembersIfNeeded().then(update).catch(() => {});

    room.on(RoomStateEvent.Events, update);
    return () => {
      room.removeListener(RoomStateEvent.Events, update);
    };
  }, [mx, roomId]);

  return members;
}
