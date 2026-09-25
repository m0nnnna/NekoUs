import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { isDeliberateChannelLeave } from './autoJoin';
import { leaveSpace, wouldOrphanSpace } from './leaveSpace';

const ME = '@me:x';

type FakeRoom = {
  roomId: string;
  space?: boolean;
  membership?: string;
  children?: string[];
  members?: Record<string, { membership: string; feed?: string }>;
  admins?: string[];
};

function fakeRoom({ roomId, space = false, membership = 'join', children = [], members = {}, admins = [] }: FakeRoom): Room {
  const room = {
    roomId,
    isSpaceRoom: () => space,
    getMyMembership: () => membership,
    getJoinedMembers: () =>
      Object.entries(members)
        .filter(([, m]) => m.membership === 'join')
        .map(([userId]) => ({ userId })),
    currentState: {
      getStateEvents: (type: string, stateKey?: string) => {
        if (type === 'm.space.child' && stateKey === undefined) {
          return children.map((id) => ({ getContent: () => ({ via: ['x'] }), getStateKey: () => id }));
        }
        if (type === 'm.room.member' && stateKey === undefined) {
          return Object.entries(members).map(([userId, m]) => ({
            getContent: () => ({ membership: m.membership, ...(m.feed && { 'xyz.nekous.feed_room': m.feed }) }),
            getStateKey: () => userId,
          }));
        }
        if (type === 'm.room.power_levels') {
          return { getContent: () => ({ users: Object.fromEntries(admins.map((id) => [id, 100])) }) };
        }
        return stateKey === undefined ? [] : undefined;
      },
    },
  };
  return room as unknown as Room;
}

function fakeClient(rooms: Room[]) {
  const byId = new Map(rooms.map((room) => [room.roomId, room]));
  const leave = vi.fn(async (roomId: string) => {
    const room = byId.get(roomId) as unknown as { getMyMembership: () => string };
    room.getMyMembership = () => 'leave';
    return {};
  });
  const mx = {
    getUserId: () => ME,
    getRoom: (id: string) => byId.get(id) ?? null,
    getRooms: () => rooms,
    leave,
  } as unknown as MatrixClient;
  return { mx, leave };
}

describe('leaveSpace', () => {
  it('leaves the Space first, then its channels and other members’ feeds, keeping your own feed', async () => {
    const space = fakeRoom({
      roomId: '!space',
      space: true,
      children: ['!general', '!voice', '!sub'],
      members: { [ME]: { membership: 'join', feed: '!myfeed' }, '@bob:x': { membership: 'join', feed: '!bobfeed' } },
    });
    const rooms = [
      space,
      fakeRoom({ roomId: '!general' }),
      fakeRoom({ roomId: '!voice' }),
      fakeRoom({ roomId: '!sub', space: true }),
      fakeRoom({ roomId: '!myfeed' }),
      fakeRoom({ roomId: '!bobfeed' }),
    ];
    const { mx, leave } = fakeClient(rooms);

    await expect(leaveSpace(mx, space)).resolves.toEqual({ failed: 0 });
    expect(leave.mock.calls.map(([id]) => id)).toEqual(['!space', '!general', '!voice', '!bobfeed']);
  });

  it('keeps a channel that another Space you’re in also lists', async () => {
    const space = fakeRoom({ roomId: '!space', space: true, children: ['!shared', '!only'] });
    const other = fakeRoom({ roomId: '!other', space: true, children: ['!shared'] });
    const { mx, leave } = fakeClient([space, other, fakeRoom({ roomId: '!shared' }), fakeRoom({ roomId: '!only' })]);

    await leaveSpace(mx, space);
    expect(leave.mock.calls.map(([id]) => id)).toEqual(['!space', '!only']);
  });

  it('counts channels it couldn’t leave, after the Space itself is gone', async () => {
    const space = fakeRoom({ roomId: '!space', space: true, children: ['!stuck'] });
    const { mx, leave } = fakeClient([space, fakeRoom({ roomId: '!stuck' })]);
    leave.mockImplementation(async (roomId: string) => {
      if (roomId === '!stuck') throw new Error('nope');
      return {};
    });
    await expect(leaveSpace(mx, space)).resolves.toEqual({ failed: 1 });
  });

  it('doesn’t let the channel leaves count as leaving each channel on purpose', async () => {
    const space = fakeRoom({ roomId: '!space', space: true });
    const { mx } = fakeClient([space]);
    const leaving = leaveSpace(mx, space);
    // Even before the Space's own leave has synced.
    expect(isDeliberateChannelLeave(mx, '!space')).toBe(false);
    await leaving;
  });
});

describe('wouldOrphanSpace', () => {
  it('warns the only admin of a Space others are still in', () => {
    const members = { [ME]: { membership: 'join' }, '@bob:x': { membership: 'join' } };
    expect(wouldOrphanSpace(fakeRoom({ roomId: '!s', members, admins: [ME] }), ME)).toBe(true);
    expect(wouldOrphanSpace(fakeRoom({ roomId: '!s', members, admins: [ME, '@bob:x'] }), ME)).toBe(false);
    expect(wouldOrphanSpace(fakeRoom({ roomId: '!s', members: { [ME]: { membership: 'join' } }, admins: [ME] }), ME)).toBe(false);
  });
});
