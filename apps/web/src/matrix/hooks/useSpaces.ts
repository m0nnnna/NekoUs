import { useEffect, useState } from 'react';
import { ClientEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

function listSpaces(mx: ReturnType<typeof useMatrixClient>): Room[] {
  return mx
    .getRooms()
    .filter((room) => room.isSpaceRoom() && room.getMyMembership() === 'join')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Joined (not merely invited — see useInvites) Matrix Spaces — mapped to Discord "servers" in
 *  the server rail. */
export function useSpaces(): Room[] {
  const mx = useMatrixClient();
  const [spaces, setSpaces] = useState<Room[]>(() => listSpaces(mx));

  useEffect(() => {
    const update = () => setSpaces(listSpaces(mx));
    update();
    mx.on(ClientEvent.Room, update);
    mx.on(ClientEvent.DeleteRoom, update);
    return () => {
      mx.removeListener(ClientEvent.Room, update);
      mx.removeListener(ClientEvent.DeleteRoom, update);
    };
  }, [mx]);

  return spaces;
}
