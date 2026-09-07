import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { acceptInvite, classifyInvite, declineInvite } from './invites';

function fakeRoom({ isSpace = false, parentSpaceId }: { isSpace?: boolean; parentSpaceId?: string } = {}): Room {
  return {
    isSpaceRoom: () => isSpace,
    currentState: {
      getStateEvents: () =>
        parentSpaceId
          ? [{ getStateKey: () => parentSpaceId }]
          : [],
    },
  } as unknown as Room;
}

function fakeClient(rooms: Record<string, Room> = {}): MatrixClient {
  return {
    getRoom: (id: string) => rooms[id] ?? null,
  } as unknown as MatrixClient;
}

describe('classifyInvite', () => {
  it('classifies a Space invite', () => {
    const mx = fakeClient();
    expect(classifyInvite(mx, fakeRoom({ isSpace: true }))).toBe('space');
  });

  it('classifies an invite to a channel with a known parent Space', () => {
    const parentSpace = fakeRoom({ isSpace: true });
    const mx = fakeClient({ '!space:example.org': parentSpace });
    expect(classifyInvite(mx, fakeRoom({ parentSpaceId: '!space:example.org' }))).toBe('channel');
  });

  it('falls back to "dm" for a non-space room with no discoverable parent Space', () => {
    const mx = fakeClient();
    expect(classifyInvite(mx, fakeRoom())).toBe('dm');
  });
});

describe('acceptInvite / declineInvite', () => {
  it('accepts by joining the room', async () => {
    const joinRoom = vi.fn().mockResolvedValue({});
    const mx = { joinRoom } as unknown as MatrixClient;
    await acceptInvite(mx, '!room:example.org');
    expect(joinRoom).toHaveBeenCalledWith('!room:example.org');
  });

  it('declines by leaving the room (Matrix has no separate reject-invite call)', async () => {
    const leave = vi.fn().mockResolvedValue({});
    const mx = { leave } as unknown as MatrixClient;
    await declineInvite(mx, '!room:example.org');
    expect(leave).toHaveBeenCalledWith('!room:example.org');
  });
});
