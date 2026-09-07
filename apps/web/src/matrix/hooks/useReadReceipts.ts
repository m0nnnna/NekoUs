import { useEffect, useState } from 'react';
import { RoomEvent, type Room, type RoomMember } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

/**
 * Maps each event ID to the room members (excluding yourself) whose read receipt currently
 * points at that exact event — i.e. what to render as "read up to here" avatars beneath a
 * message, the same way Element does it.
 */
export function useReadReceipts(roomId: string | null): Map<string, RoomMember[]> {
  const mx = useMatrixClient();
  const [receipts, setReceipts] = useState<Map<string, RoomMember[]>>(new Map());

  useEffect(() => {
    if (!roomId) {
      setReceipts(new Map());
      return undefined;
    }
    const room = mx.getRoom(roomId);
    if (!room) {
      setReceipts(new Map());
      return undefined;
    }

    const myUserId = mx.getUserId();

    const update = () => {
      const map = new Map<string, RoomMember[]>();
      room.getJoinedMembers().forEach((member) => {
        if (member.userId === myUserId) return;
        const eventId = room.getEventReadUpTo(member.userId, true);
        if (!eventId) return;
        const list = map.get(eventId) ?? [];
        list.push(member);
        map.set(eventId, list);
      });
      setReceipts(map);
    };

    update();

    const onReceipt = (_event: unknown, receiptRoom: Room) => {
      if (receiptRoom.roomId === roomId) update();
    };
    mx.on(RoomEvent.Receipt, onReceipt);
    return () => {
      mx.removeListener(RoomEvent.Receipt, onReceipt);
    };
  }, [mx, roomId]);

  return receipts;
}
