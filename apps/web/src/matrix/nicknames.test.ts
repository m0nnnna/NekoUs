import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { clearSpaceNickname, getSpaceNickname, reconcileSpaceNickname, setSpaceNickname } from './nicknames';

const SPACE_NICKNAMES_EVENT = 'xyz.nekous.space_nicknames';

function fakeRoom(roomId: string, existingDisplayName?: string): Room {
  return {
    roomId,
    currentState: {
      getStateEvents: () => (existingDisplayName === undefined ? null : { getContent: () => ({ displayname: existingDisplayName }) }),
    },
  } as unknown as Room;
}

function fakeClient({
  accountData = {},
  globalDisplayName = 'RealName',
}: {
  accountData?: Record<string, string>;
  globalDisplayName?: string;
} = {}) {
  const sendStateEvent = vi.fn().mockResolvedValue({});
  const setAccountData = vi.fn().mockResolvedValue({});
  const getProfileInfo = vi.fn().mockResolvedValue({ displayname: globalDisplayName });
  const mx = {
    getUserId: () => '@me:example.org',
    getAccountData: (type: string) =>
      type === SPACE_NICKNAMES_EVENT ? { getContent: () => accountData } : undefined,
    setAccountData,
    sendStateEvent,
    getProfileInfo,
    // Deliberately NOT implemented — clearSpaceNickname must not call this. Regression test for
    // the bug where reading "the global name" from mx.getUser().displayName silently reapplied a
    // per-room nickname override instead of resetting to the real account name, because every
    // matrix-js-sdk store shares one User object per user ID that gets clobbered by any room's
    // own m.room.member event for that user.
    getUser: () => {
      throw new Error('getUser() must not be used to determine the global display name');
    },
  } as unknown as MatrixClient;
  return { mx, sendStateEvent, setAccountData, getProfileInfo };
}

describe('getSpaceNickname', () => {
  it('reads the saved nickname for a space from account data', () => {
    const { mx } = fakeClient({ accountData: { '!space:example.org': 'Nicky' } });
    expect(getSpaceNickname(mx, '!space:example.org')).toBe('Nicky');
  });

  it('returns undefined when no nickname is saved for that space', () => {
    const { mx } = fakeClient({ accountData: {} });
    expect(getSpaceNickname(mx, '!space:example.org')).toBeUndefined();
  });
});

describe('setSpaceNickname', () => {
  it('saves the preference and applies it to every child room', async () => {
    const { mx, sendStateEvent, setAccountData } = fakeClient();
    const space = fakeRoom('!space:example.org');
    const rooms = [fakeRoom('!a:example.org', 'OldName'), fakeRoom('!b:example.org', 'OldName')];

    await setSpaceNickname(mx, space, rooms, 'Nicky');

    expect(setAccountData).toHaveBeenCalledWith(SPACE_NICKNAMES_EVENT, { '!space:example.org': 'Nicky' });
    expect(sendStateEvent).toHaveBeenCalledTimes(2);
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!a:example.org',
      'm.room.member',
      expect.objectContaining({ displayname: 'Nicky' }),
      '@me:example.org'
    );
  });

  it('skips a room whose member event already has the right displayname', async () => {
    const { mx, sendStateEvent } = fakeClient();
    const space = fakeRoom('!space:example.org');
    const rooms = [fakeRoom('!a:example.org', 'Nicky')];

    await setSpaceNickname(mx, space, rooms, 'Nicky');

    expect(sendStateEvent).not.toHaveBeenCalled();
  });
});

describe('clearSpaceNickname', () => {
  it('resets every child room to the real global display name, fetched via the profile API', async () => {
    const { mx, sendStateEvent, setAccountData, getProfileInfo } = fakeClient({
      accountData: { '!space:example.org': 'Nicky' },
      globalDisplayName: 'RealName',
    });
    const space = fakeRoom('!space:example.org');
    const rooms = [fakeRoom('!a:example.org', 'Nicky'), fakeRoom('!b:example.org', 'Nicky')];

    await clearSpaceNickname(mx, space, rooms);

    expect(getProfileInfo).toHaveBeenCalledWith('@me:example.org');
    expect(setAccountData).toHaveBeenCalledWith(SPACE_NICKNAMES_EVENT, {});
    expect(sendStateEvent).toHaveBeenCalledTimes(2);
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!a:example.org',
      'm.room.member',
      expect.objectContaining({ displayname: 'RealName' }),
      '@me:example.org'
    );
  });
});

describe('reconcileSpaceNickname', () => {
  it('does nothing when the space has no saved nickname', async () => {
    const { mx, sendStateEvent } = fakeClient({ accountData: {} });
    const space = fakeRoom('!space:example.org');
    const rooms = [fakeRoom('!a:example.org', 'OldName')];

    await reconcileSpaceNickname(mx, space, rooms);

    expect(sendStateEvent).not.toHaveBeenCalled();
  });

  it('reapplies a saved nickname to a room missing it', async () => {
    const { mx, sendStateEvent } = fakeClient({ accountData: { '!space:example.org': 'Nicky' } });
    const space = fakeRoom('!space:example.org');
    const rooms = [fakeRoom('!new:example.org', 'OldName')];

    await reconcileSpaceNickname(mx, space, rooms);

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!new:example.org',
      'm.room.member',
      expect.objectContaining({ displayname: 'Nicky' }),
      '@me:example.org'
    );
  });
});
