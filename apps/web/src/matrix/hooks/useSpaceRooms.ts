import { useEffect, useState } from 'react';
import { ClientEvent, EventType, RoomStateEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

type SpaceChildContent = { via?: string[]; order?: string };

/**
 * Rooms under a Space, resolved from `m.space.child` state events — mapped to Discord
 * "channels". Deletion is represented per-spec by an empty content (no `via`), so that's
 * treated as "not a child". Ordering follows the spec's `order` field (lexicographic string
 * sort), falling back to room name for children without one. Sub-spaces are excluded — nested
 * space navigation isn't in scope yet.
 */
function listChildRooms(mx: ReturnType<typeof useMatrixClient>, spaceId: string): Room[] {
  const space = mx.getRoom(spaceId);
  if (!space) return [];

  const childEvents = space.currentState.getStateEvents(EventType.SpaceChild) as MatrixEvent[];
  const children: { room: Room; order?: string }[] = [];

  childEvents.forEach((event) => {
    const content = event.getContent<SpaceChildContent>();
    if (!content.via || content.via.length === 0) return;
    const room = mx.getRoom(event.getStateKey() ?? '');
    // A room you're only invited to (not joined) is surfaced through useInvites instead — see
    // its own comment for why nothing here used to filter on membership at all.
    if (room && !room.isSpaceRoom() && room.getMyMembership() === 'join') {
      children.push({ room, order: content.order });
    }
  });

  children.sort((a, b) => {
    if (a.order && b.order) return a.order.localeCompare(b.order);
    if (a.order) return -1;
    if (b.order) return 1;
    return a.room.name.localeCompare(b.room.name);
  });

  return children.map((c) => c.room);
}

export function useSpaceRooms(spaceId: string | null): Room[] {
  const mx = useMatrixClient();
  const [rooms, setRooms] = useState<Room[]>(() => (spaceId ? listChildRooms(mx, spaceId) : []));

  useEffect(() => {
    if (!spaceId) {
      setRooms([]);
      return undefined;
    }
    const update = () => setRooms(listChildRooms(mx, spaceId));
    update();
    mx.on(RoomStateEvent.Events, update);
    mx.on(ClientEvent.Room, update);
    return () => {
      mx.removeListener(RoomStateEvent.Events, update);
      mx.removeListener(ClientEvent.Room, update);
    };
  }, [mx, spaceId]);

  return rooms;
}
