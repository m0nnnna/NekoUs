import { describe, expect, it, vi } from 'vitest';
import { Visibility, type MatrixClient } from 'matrix-js-sdk';
import { createRoom } from './roomCreation';

function fakeClient() {
  const createRoomFn = vi.fn().mockResolvedValue({ room_id: '!new:example.org' });
  const mx = {
    getUserId: () => '@me:example.org',
    createRoom: createRoomFn,
    sendStateEvent: vi.fn().mockResolvedValue({}),
  } as unknown as MatrixClient;
  return { mx, createRoomFn };
}

describe('createRoom', () => {
  it('publishes to the directory (visibility: public) when isPublic is set, not just the join rule', () => {
    const { mx, createRoomFn } = fakeClient();
    void createRoom(mx, { name: 'Open Room', isPublic: true });
    expect(createRoomFn).toHaveBeenCalledWith(expect.objectContaining({ visibility: Visibility.Public }));
  });

  it('keeps a non-public room out of the directory', () => {
    const { mx, createRoomFn } = fakeClient();
    void createRoom(mx, { name: 'Closed Room', isPublic: false });
    expect(createRoomFn).toHaveBeenCalledWith(expect.objectContaining({ visibility: Visibility.Private }));
  });
});
