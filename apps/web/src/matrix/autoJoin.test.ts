import { describe, expect, it, vi } from 'vitest';
import { EventType, RoomType, type MatrixClient, type Room } from 'matrix-js-sdk';
import {
  autoJoinCandidates,
  autoJoinNewChannel,
  autoJoinSpaceChannels,
  forgetLeftChannel,
  isAutoJoinable,
  readLeftChannels,
  rememberLeftChannel,
} from './autoJoin';
import { voiceChildrenMissingHint } from './spaceChildren';

const SPACE = '!space:example.org';

const entry = (roomId: string, extra: Record<string, unknown> = {}) =>
  ({ room_id: roomId, num_joined_members: 1, world_readable: false, guest_can_join: false, ...extra }) as never;

describe('isAutoJoinable', () => {
  it('joins public channels, which the server lists with no join rule at all', () => {
    expect(isAutoJoinable(entry('!a:x'), SPACE)).toBe(true);
    expect(isAutoJoinable(entry('!a:x', { join_rule: 'public' }), SPACE)).toBe(true);
  });

  it('joins channels restricted to this space', () => {
    expect(isAutoJoinable(entry('!a:x', { join_rule: 'restricted', allowed_room_ids: [SPACE] }), SPACE)).toBe(true);
  });

  it('leaves invite-only and knock channels alone', () => {
    expect(isAutoJoinable(entry('!a:x', { join_rule: 'invite' }), SPACE)).toBe(false);
    expect(isAutoJoinable(entry('!a:x', { join_rule: 'knock' }), SPACE)).toBe(false);
  });

  it('leaves a channel restricted to some other room alone', () => {
    expect(isAutoJoinable(entry('!a:x', { join_rule: 'restricted', allowed_room_ids: ['!elsewhere:x'] }), SPACE)).toBe(false);
  });

  it('never joins sub-spaces as if they were channels', () => {
    expect(isAutoJoinable(entry('!sub:x', { room_type: RoomType.Space }), SPACE)).toBe(false);
  });
});

describe('autoJoinCandidates', () => {
  const entries = [entry('!new:x'), entry('!joined:x'), entry('!invited:x'), entry('!left:x'), entry('!staff:x', { join_rule: 'invite' })];
  const membership: Record<string, string> = { '!joined:x': 'join', '!invited:x': 'invite' };

  it('picks joinable channels you are not already in and have not left', () => {
    expect(autoJoinCandidates(entries, SPACE, (id) => membership[id], new Set(['!left:x']))).toEqual(['!new:x']);
  });
});

function fakeClient(opts: { membership?: Record<string, string>; failJoin?: string[]; hierarchy?: unknown[] } = {}) {
  const accountData = new Map<string, Record<string, unknown>>();
  const joinRoom = vi.fn(async (roomId: string) => {
    if (opts.failJoin?.includes(roomId)) throw new Error('M_FORBIDDEN');
    return { roomId };
  });
  const mx = {
    getRoom: (roomId: string) =>
      opts.membership?.[roomId] ? ({ getMyMembership: () => opts.membership![roomId] } as unknown as Room) : null,
    getAccountData: (type: string) => {
      const content = accountData.get(type);
      return content ? { getContent: () => content } : undefined;
    },
    setAccountData: vi.fn(async (type: string, content: Record<string, unknown>) => {
      accountData.set(type, content);
    }),
    getRoomHierarchy: vi.fn(async () => ({ rooms: [entry(SPACE), ...(opts.hierarchy ?? [])] })),
    joinRoom,
  } as unknown as MatrixClient;
  return { mx, joinRoom };
}

describe('autoJoinSpaceChannels', () => {
  it('joins every joinable channel, and carries on past one that refuses', async () => {
    const { mx, joinRoom } = fakeClient({
      hierarchy: [entry('!a:x'), entry('!b:x'), entry('!c:x', { join_rule: 'invite' })],
      failJoin: ['!a:x'],
    });
    await expect(autoJoinSpaceChannels(mx, SPACE)).resolves.toEqual(['!b:x']);
    expect(joinRoom.mock.calls.map((call) => call[0]).sort()).toEqual(['!a:x', '!b:x']);
  });

  it('skips channels you left, unless asked to include them ("Join all")', async () => {
    const { mx, joinRoom } = fakeClient({ hierarchy: [entry('!left:x')] });
    await rememberLeftChannel(mx, '!left:x');
    await expect(autoJoinSpaceChannels(mx, SPACE)).resolves.toEqual([]);
    await expect(autoJoinSpaceChannels(mx, SPACE, { includeLeft: true })).resolves.toEqual(['!left:x']);
    expect(joinRoom).toHaveBeenCalledTimes(1);
  });
});

describe('autoJoinNewChannel', () => {
  it('joins a channel just added to the space', async () => {
    const { mx } = fakeClient();
    await expect(autoJoinNewChannel(mx, SPACE, '!fresh:x')).resolves.toBe(true);
  });

  it('does nothing for one you are already in, or one you left', async () => {
    const { mx, joinRoom } = fakeClient({ membership: { '!in:x': 'join' } });
    await rememberLeftChannel(mx, '!gone:x');
    await expect(autoJoinNewChannel(mx, SPACE, '!in:x')).resolves.toBe(false);
    await expect(autoJoinNewChannel(mx, SPACE, '!gone:x')).resolves.toBe(false);
    expect(joinRoom).not.toHaveBeenCalled();
  });
});

describe('left channels', () => {
  it('remembers and forgets', async () => {
    const { mx } = fakeClient();
    await rememberLeftChannel(mx, '!a:x');
    expect([...readLeftChannels(mx)]).toEqual(['!a:x']);
    await forgetLeftChannel(mx, '!a:x');
    expect([...readLeftChannels(mx)]).toEqual([]);
  });
});

describe('voiceChildrenMissingHint', () => {
  function fakeRoom(roomId: string, type: 'voice' | 'text') {
    return {
      roomId,
      currentState: {
        getStateEvents: (t: string) => (t === 'xyz.nekous.channel_type' ? { getContent: () => ({ type }) } : null),
      },
    } as unknown as Room;
  }
  const links: Record<string, Record<string, unknown>> = {
    '!old-voice:x': { via: ['x'] },
    '!new-voice:x': { via: ['x'], 'xyz.nekous.channel_type': 'voice' },
    '!text:x': { via: ['x'] },
    '!unlinked-voice:x': {},
  };
  const space = {
    currentState: {
      getStateEvents: (t: string, key: string) => (t === EventType.SpaceChild && links[key] ? { getContent: () => links[key] } : null),
    },
  } as unknown as Room;

  it('finds linked voice channels whose link lacks the marker, and nothing else', () => {
    const channels = [
      fakeRoom('!old-voice:x', 'voice'),
      fakeRoom('!new-voice:x', 'voice'),
      fakeRoom('!text:x', 'text'),
      fakeRoom('!unlinked-voice:x', 'voice'),
    ];
    expect(voiceChildrenMissingHint(space, channels).map((room) => room.roomId)).toEqual(['!old-voice:x']);
  });
});
