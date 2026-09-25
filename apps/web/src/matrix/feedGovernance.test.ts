import { describe, expect, it } from 'vitest';
import type { Room } from 'matrix-js-sdk';
import { POST_EVENT_TYPE } from './feed';
import {
  canModerateFeed,
  FEED_MODERATOR_LEVEL,
  feedMembersToRemove,
  isRemovedFromSpace,
  spaceModerators,
  wantedFeedPowerLevels,
} from './feedGovernance';

type FakeRoomOptions = {
  powerLevels?: Record<string, unknown>;
  create?: { sender: string; content: Record<string, unknown> };
  members?: Record<string, string>;
  myMembership?: string;
};

function fakeRoom({ powerLevels = {}, create, members = {}, myMembership = 'join' }: FakeRoomOptions): Room {
  return {
    getMyMembership: () => myMembership,
    currentState: {
      getStateEvents: (type: string) => {
        if (type === 'm.room.power_levels') return { getContent: () => powerLevels };
        if (type === 'm.room.create' && create) return { getContent: () => create.content, getSender: () => create.sender };
        return undefined;
      },
    },
    getMember: (userId: string) => (members[userId] ? { userId, membership: members[userId] } : null),
    getJoinedMembers: () =>
      Object.entries(members)
        .filter(([, membership]) => membership === 'join')
        .map(([userId]) => ({ userId })),
  } as unknown as Room;
}

describe('spaceModerators', () => {
  it('lists users at or above the Space redact level', () => {
    const space = fakeRoom({ powerLevels: { users: { '@admin:x': 100, '@mod:x': 50, '@user:x': 0 } } });
    expect(spaceModerators(space).sort()).toEqual(['@admin:x', '@mod:x']);
  });

  it('respects a raised redact level', () => {
    const space = fakeRoom({ powerLevels: { redact: 75, users: { '@admin:x': 100, '@mod:x': 50 } } });
    expect(spaceModerators(space)).toEqual(['@admin:x']);
  });

  it('includes creators on room version 12, who are never listed in power levels', () => {
    const space = fakeRoom({
      powerLevels: { users: { '@mod:x': 50 } },
      create: { sender: '@founder:x', content: { room_version: '12', additional_creators: ['@cofounder:x'] } },
    });
    expect(spaceModerators(space).sort()).toEqual(['@cofounder:x', '@founder:x', '@mod:x']);
  });

  it('does not treat the creator as privileged on older room versions', () => {
    const space = fakeRoom({ powerLevels: { users: {} }, create: { sender: '@founder:x', content: { room_version: '10' } } });
    expect(spaceModerators(space)).toEqual([]);
  });
});

describe('wantedFeedPowerLevels', () => {
  const created = {
    users: { '@owner:x': 100 },
    events: { [POST_EVENT_TYPE]: 100, 'm.room.name': 50, 'm.room.power_levels': 100 },
    users_default: 0,
  };

  it('adds moderators at 50 and locks every state event to the owner', () => {
    const wanted = wantedFeedPowerLevels(created, '@owner:x', ['@mod:x']);
    expect(wanted?.users).toEqual({ '@owner:x': 100, '@mod:x': FEED_MODERATOR_LEVEL });
    expect(wanted?.state_default).toBe(100);
    expect(wanted?.events?.['m.room.name']).toBe(100);
    expect(wanted?.events?.[POST_EVENT_TYPE]).toBe(100);
    expect(wanted?.redact).toBe(50);
    expect(wanted?.kick).toBe(50);
    expect(wanted?.users_default).toBe(0);
  });

  it('is undefined once applied, so an up-to-date feed is never rewritten', () => {
    const wanted = wantedFeedPowerLevels(created, '@owner:x', ['@mod:x'])!;
    expect(wantedFeedPowerLevels(wanted, '@owner:x', ['@mod:x'])).toBeUndefined();
  });

  it('removes someone who is no longer a Space moderator', () => {
    const current = wantedFeedPowerLevels(created, '@owner:x', ['@mod:x', '@old:x'])!;
    const wanted = wantedFeedPowerLevels(current, '@owner:x', ['@mod:x']);
    expect(wanted?.users).toEqual({ '@owner:x': 100, '@mod:x': 50 });
  });

  it('never lists the owner when they were not listed (a room version 12 creator)', () => {
    const wanted = wantedFeedPowerLevels({ users: {} }, '@owner:x', ['@owner:x', '@mod:x']);
    expect(wanted?.users).toEqual({ '@mod:x': 50 });
  });
});

describe('feedMembersToRemove', () => {
  it('removes anyone in the feed who is not joined to the Space, never the owner', () => {
    const feed = fakeRoom({ members: { '@owner:x': 'join', '@stays:x': 'join', '@banned:x': 'join', '@left:x': 'join', '@never:x': 'join' } });
    const space = fakeRoom({ members: { '@owner:x': 'leave', '@stays:x': 'join', '@banned:x': 'ban', '@left:x': 'leave' } });
    expect(feedMembersToRemove(feed, space, '@owner:x').sort()).toEqual(['@banned:x', '@left:x', '@never:x']);
  });
});

describe('isRemovedFromSpace', () => {
  it('is true only when the Space says they left or were banned', () => {
    const space = fakeRoom({ members: { '@a:x': 'join', '@b:x': 'leave', '@c:x': 'ban' } });
    expect(isRemovedFromSpace(space, '@a:x')).toBe(false);
    expect(isRemovedFromSpace(space, '@b:x')).toBe(true);
    expect(isRemovedFromSpace(space, '@c:x')).toBe(true);
    // Not loaded yet is not the same as gone.
    expect(isRemovedFromSpace(space, '@unknown:x')).toBe(false);
    expect(isRemovedFromSpace(null, '@b:x')).toBe(false);
  });
});

describe('canModerateFeed', () => {
  it('needs the redact level in a feed you have joined', () => {
    const feed = fakeRoom({ powerLevels: { users: { '@mod:x': 50 }, redact: 50 } });
    expect(canModerateFeed(feed, '@mod:x')).toBe(true);
    expect(canModerateFeed(feed, '@user:x')).toBe(false);
    expect(canModerateFeed(fakeRoom({ powerLevels: { users: { '@mod:x': 50 } }, myMembership: 'leave' }), '@mod:x')).toBe(false);
  });

  it('treats a room version 12 creator as able to moderate', () => {
    const feed = fakeRoom({ powerLevels: { users: {} }, create: { sender: '@owner:x', content: { room_version: '12' } } });
    expect(canModerateFeed(feed, '@owner:x')).toBe(true);
  });
});
