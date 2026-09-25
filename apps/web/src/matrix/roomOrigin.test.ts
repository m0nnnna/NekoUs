import { describe, expect, it } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { joinViaServers, roomOriginServer, serverNameOf } from './roomOrigin';

function roomCreatedBy(roomId: string, creator?: string): Room {
  return {
    roomId,
    currentState: {
      getStateEvents: (type: string) => (type === 'm.room.create' && creator ? { getSender: () => creator } : null),
    },
  } as unknown as Room;
}

// Room version 12 (Continuwuity's default): room IDs are a bare hash with no `:server` part.
const V12 = '!Q3pZkS8xV12roomHash';

describe('roomOriginServer', () => {
  it('uses the m.room.create sender, which works in every room version', () => {
    expect(roomOriginServer(roomCreatedBy(V12, '@alice:cats.example'))).toBe('cats.example');
    expect(roomOriginServer(roomCreatedBy('!old:ignored.example', '@alice:cats.example'))).toBe('cats.example');
  });

  it('falls back to the room ID only where it still names a server', () => {
    expect(roomOriginServer(roomCreatedBy('!old:cats.example'))).toBe('cats.example');
    expect(roomOriginServer(undefined, '!old:cats.example')).toBe('cats.example');
  });

  it('is unknown, not empty, for a v12 room it knows nothing about', () => {
    expect(serverNameOf(V12)).toBe('');
    expect(roomOriginServer(undefined, V12)).toBeUndefined();
  });
});

describe('joinViaServers', () => {
  const mx = (rooms: Room[] = []) =>
    ({ getUserId: () => '@me:home.example', getRoom: (id: string) => rooms.find((r) => r.roomId === id) }) as unknown as MatrixClient;

  it("joins a v12 channel through its Space's creator and your own server, never an empty entry", () => {
    const space = roomCreatedBy('!SpaceV12Hash', '@admin:cats.example');
    expect(joinViaServers(mx([space]), V12, '!SpaceV12Hash')).toEqual(['cats.example', 'home.example']);
  });

  it('keeps an older room ID’s own server first, without duplicates', () => {
    const space = roomCreatedBy('!space:cats.example', '@admin:cats.example');
    expect(joinViaServers(mx([space]), '!chan:cats.example', '!space:cats.example')).toEqual(['cats.example', 'home.example']);
  });
});
