import { EventType, type MatrixClient, type Room } from 'matrix-js-sdk';

function currentPinned(room: Room): string[] {
  return room.currentState.getStateEvents(EventType.RoomPinnedEvents, '')?.getContent<{ pinned?: string[] }>()
    .pinned ?? [];
}

export async function pinMessage(mx: MatrixClient, room: Room, eventId: string): Promise<void> {
  const pinned = currentPinned(room);
  if (pinned.includes(eventId)) return;
  await mx.sendStateEvent(room.roomId, EventType.RoomPinnedEvents, { pinned: [...pinned, eventId] });
}

export async function unpinMessage(mx: MatrixClient, room: Room, eventId: string): Promise<void> {
  const pinned = currentPinned(room);
  await mx.sendStateEvent(room.roomId, EventType.RoomPinnedEvents, {
    pinned: pinned.filter((id) => id !== eventId),
  });
}
