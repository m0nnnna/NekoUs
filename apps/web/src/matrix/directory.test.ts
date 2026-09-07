import { describe, expect, it, vi } from 'vitest';
import { RoomType, type IPublicRoomsChunkRoom, type MatrixClient } from 'matrix-js-sdk';
import { browsePublicRooms, isSpaceEntry, joinPublicRoom } from './directory';

function fakeChunkRoom(overrides: Partial<IPublicRoomsChunkRoom> = {}): IPublicRoomsChunkRoom {
  return {
    room_id: '!room:example.org',
    world_readable: true,
    guest_can_join: false,
    num_joined_members: 3,
    ...overrides,
  };
}

describe('isSpaceEntry', () => {
  it('recognizes a public Space by its room_type', () => {
    expect(isSpaceEntry(fakeChunkRoom({ room_type: RoomType.Space }))).toBe(true);
  });

  it('treats a plain room (no room_type) as not a Space', () => {
    expect(isSpaceEntry(fakeChunkRoom())).toBe(false);
  });
});

describe('browsePublicRooms', () => {
  it('omits the filter entirely when no search term is given', async () => {
    const publicRooms = vi.fn().mockResolvedValue({ chunk: [] });
    const mx = { publicRooms } as unknown as MatrixClient;

    await browsePublicRooms(mx, {});

    expect(publicRooms).toHaveBeenCalledWith(
      expect.objectContaining({ filter: undefined, since: undefined })
    );
  });

  it('passes a trimmed search term as generic_search_term', async () => {
    const publicRooms = vi.fn().mockResolvedValue({ chunk: [] });
    const mx = { publicRooms } as unknown as MatrixClient;

    await browsePublicRooms(mx, { searchTerm: '  music  ' });

    expect(publicRooms).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { generic_search_term: 'music' } })
    );
  });

  it('forwards a pagination token as since', async () => {
    const publicRooms = vi.fn().mockResolvedValue({ chunk: [] });
    const mx = { publicRooms } as unknown as MatrixClient;

    await browsePublicRooms(mx, { since: 'batch-token' });

    expect(publicRooms).toHaveBeenCalledWith(expect.objectContaining({ since: 'batch-token' }));
  });
});

describe('joinPublicRoom', () => {
  it('joins by room ID or alias and resolves the joined room ID', async () => {
    const joinRoom = vi.fn().mockResolvedValue({ roomId: '!resolved:example.org' });
    const mx = { joinRoom } as unknown as MatrixClient;

    const roomId = await joinPublicRoom(mx, '#public-room:example.org');

    expect(joinRoom).toHaveBeenCalledWith('#public-room:example.org');
    expect(roomId).toBe('!resolved:example.org');
  });
});
