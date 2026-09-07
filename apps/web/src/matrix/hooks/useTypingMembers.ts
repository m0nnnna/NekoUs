import { useEffect, useState } from 'react';
import { RoomMemberEvent, type RoomMember } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

/** Members (excluding yourself) currently showing a typing indicator in this room. */
export function useTypingMembers(roomId: string | null): RoomMember[] {
  const mx = useMatrixClient();
  const [typing, setTyping] = useState<RoomMember[]>([]);

  useEffect(() => {
    if (!roomId) {
      setTyping([]);
      return undefined;
    }
    const room = mx.getRoom(roomId);
    if (!room) {
      setTyping([]);
      return undefined;
    }
    const myUserId = mx.getUserId();

    const update = () => {
      setTyping(room.getJoinedMembers().filter((member) => member.typing && member.userId !== myUserId));
    };
    update();

    const onTyping = (_event: unknown, member: RoomMember) => {
      if (member.roomId === roomId) update();
    };
    mx.on(RoomMemberEvent.Typing, onTyping);
    return () => {
      mx.removeListener(RoomMemberEvent.Typing, onTyping);
    };
  }, [mx, roomId]);

  return typing;
}
