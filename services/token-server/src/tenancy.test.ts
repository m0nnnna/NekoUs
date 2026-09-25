import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  confirmLocalOrigin,
  isRoomServed,
  mayAcceptInvite,
  serverNameOf,
  servedSpaceIds,
  servedVoiceChannelIds,
} from './tenancy.js';

const BOT = '@purrlor-voice-bot:example.org';

type FakeRoomSpec = {
  roomId: string;
  membership?: string;
  isSpace?: boolean;
  /** `m.space.child` state keys this room publishes, i.e. the rooms it claims as children. */
  children?: string[];
  /** Children listed with an emptied content — Matrix's way of spelling "no longer a child". */
  unlinkedChildren?: string[];
  /** Children whose link carries the voice marker (xyz.nekous.channel_type: voice). */
  voiceChildren?: string[];
  /** Who sent m.room.create — how a room-version-12 room's origin is known. */
  creator?: string;
};

function fakeRoom(spec: FakeRoomSpec) {
  const linked = (spec.children ?? []).map((roomId) => ({
    getStateKey: () => roomId,
    getContent: () => ({ via: ['example.org'] }),
  }));
  const voice = (spec.voiceChildren ?? []).map((roomId) => ({
    getStateKey: () => roomId,
    getContent: () => ({ via: ['example.org'], 'xyz.nekous.channel_type': 'voice' }),
  }));
  const unlinked = (spec.unlinkedChildren ?? []).map((roomId) => ({
    getStateKey: () => roomId,
    getContent: () => ({}),
  }));
  const all = [...linked, ...voice, ...unlinked];

  return {
    roomId: spec.roomId,
    getMyMembership: () => spec.membership ?? 'join',
    isSpaceRoom: () => Boolean(spec.isSpace),
    getType: () => (spec.isSpace ? 'm.space' : undefined),
    currentState: {
      getStateEvents: (type: string, stateKey?: string) => {
        if (type === 'm.room.create') return spec.creator ? { getSender: () => spec.creator } : null;
        return stateKey === undefined ? all : (all.find((e) => e.getStateKey() === stateKey) ?? null);
      },
    },
  };
}

function fakeClient(specs: FakeRoomSpec[], remoteState: Record<string, string[]> = {}) {
  const rooms = specs.map(fakeRoom);
  const stateLookups: string[] = [];
  const mx = {
    getUserId: () => BOT,
    getRooms: () => rooms,
    getRoom: (roomId: string) => rooms.find((room) => room.roomId === roomId),
    // Stands in for the homeserver's own answer, which `isChildOfServedSpace` falls back to
    // when the bot's synced copy of a Space hasn't caught up yet.
    getStateEvent: async (spaceId: string, _type: string, stateKey: string) => {
      stateLookups.push(`${spaceId}/${stateKey}`);
      if (!(remoteState[spaceId] ?? []).includes(stateKey)) throw new Error('M_NOT_FOUND');
      return { via: ['example.org'] };
    },
  } as unknown as MatrixClient;
  return { mx, stateLookups };
}

const SPACE = '!space:example.org';
const CHANNEL = '!voice:example.org';

afterEach(() => {
  delete process.env.VOICE_ALLOWED_SPACES;
});

describe('serverNameOf', () => {
  it('takes everything after the first colon, so a port survives', () => {
    assert.equal(serverNameOf('!room:example.org:8448'), 'example.org:8448');
    assert.equal(serverNameOf('@user:example.org'), 'example.org');
    assert.equal(serverNameOf('nonsense'), '');
  });
});

describe('isRoomServed', () => {
  it('serves a channel its space claims as a child', async () => {
    const { mx } = fakeClient([
      { roomId: SPACE, isSpace: true, children: [CHANNEL] },
      { roomId: CHANNEL },
    ]);
    assert.equal(await isRoomServed(mx, CHANNEL), true);
  });

  it('refuses a room no space lists, however loudly the room itself claims a parent', async () => {
    // Only m.space.child is consulted, and only a space's own admins can write it — a room
    // setting m.space.parent at your space is exactly the forgery this direction prevents.
    const { mx } = fakeClient([
      { roomId: SPACE, isSpace: true, children: [] },
      { roomId: '!impostor:example.org' },
    ]);
    assert.equal(await isRoomServed(mx, '!impostor:example.org'), false);
  });

  it('refuses a room on another homeserver even when a served space lists it', async () => {
    const remote = '!voice:evil.example';
    const { mx } = fakeClient([
      { roomId: SPACE, isSpace: true, children: [remote] },
      { roomId: remote },
    ]);
    assert.equal(await isRoomServed(mx, remote), false);
  });

  it('refuses a child that has been unlinked (m.space.child emptied)', async () => {
    const { mx } = fakeClient([
      { roomId: SPACE, isSpace: true, unlinkedChildren: [CHANNEL] },
      { roomId: CHANNEL },
    ]);
    assert.equal(await isRoomServed(mx, CHANNEL), false);
  });

  it('refuses everything when the bot is in no space at all', async () => {
    const { mx } = fakeClient([{ roomId: CHANNEL }]);
    assert.equal(await isRoomServed(mx, CHANNEL), false);
  });

  it('ignores a space the bot has only been invited to, not joined', async () => {
    const { mx } = fakeClient([
      { roomId: SPACE, isSpace: true, membership: 'invite', children: [CHANNEL] },
      { roomId: CHANNEL },
    ]);
    assert.equal(await isRoomServed(mx, CHANNEL), false);
  });

  it('asks the homeserver for a room it knows, covering the freshly created channel', async () => {
    // roomCreation.ts writes the room first and its m.space.child link a round trip later, so a
    // caller can legitimately arrive before the bot has synced the link.
    const { mx, stateLookups } = fakeClient(
      [
        { roomId: SPACE, isSpace: true, children: [] },
        { roomId: CHANNEL, membership: 'invite' },
      ],
      { [SPACE]: [CHANNEL] }
    );
    assert.equal(await isRoomServed(mx, CHANNEL), true);
    assert.deepEqual(stateLookups, [`${SPACE}/${CHANNEL}`]);
  });

  it('does not spend a homeserver round trip on a room ID it has never heard of', async () => {
    // room_id arrives on an unauthenticated request body; a fallback that ran for any string
    // would turn one request into one lookup per served space.
    const { mx, stateLookups } = fakeClient([{ roomId: SPACE, isSpace: true, children: [] }]);
    assert.equal(await isRoomServed(mx, '!made-up:example.org'), false);
    assert.deepEqual(stateLookups, []);
  });
});

describe('VOICE_ALLOWED_SPACES', () => {
  it('serves only the spaces it names', async () => {
    const other = '!other:example.org';
    const otherChannel = '!other-voice:example.org';
    process.env.VOICE_ALLOWED_SPACES = SPACE;
    const { mx } = fakeClient([
      { roomId: SPACE, isSpace: true, children: [CHANNEL] },
      { roomId: other, isSpace: true, children: [otherChannel] },
      { roomId: CHANNEL },
      { roomId: otherChannel },
    ]);
    assert.deepEqual([...servedSpaceIds(mx)], [SPACE]);
    assert.equal(await isRoomServed(mx, CHANNEL), true);
    assert.equal(await isRoomServed(mx, otherChannel), false);
  });

  it('extends to a sub-space, which inherits its parent voice server in the client', async () => {
    const sub = '!sub:example.org';
    const subChannel = '!sub-voice:example.org';
    process.env.VOICE_ALLOWED_SPACES = SPACE;
    const { mx } = fakeClient([
      { roomId: SPACE, isSpace: true, children: [sub] },
      { roomId: sub, isSpace: true, children: [subChannel] },
      { roomId: subChannel },
    ]);
    assert.equal(await isRoomServed(mx, subChannel), true);
  });

  it('ignores a named space the bot was never actually put into', async () => {
    process.env.VOICE_ALLOWED_SPACES = `${SPACE}, !never-joined:example.org`;
    const { mx } = fakeClient([{ roomId: SPACE, isSpace: true, children: [CHANNEL] }, { roomId: CHANNEL }]);
    assert.deepEqual([...servedSpaceIds(mx)], [SPACE]);
  });
});

describe('mayAcceptInvite', () => {
  it('accepts a local space invite, which is how the bot gets its first anchor', async () => {
    const { mx } = fakeClient([{ roomId: SPACE, isSpace: true, membership: 'invite' }]);
    assert.equal(await mayAcceptInvite(mx, SPACE), true);
  });

  it('refuses a space invite from another homeserver', async () => {
    const remoteSpace = '!space:evil.example';
    const { mx } = fakeClient([{ roomId: remoteSpace, isSpace: true, membership: 'invite' }]);
    assert.equal(await mayAcceptInvite(mx, remoteSpace), false);
  });

  it('refuses a space invite that the allowlist does not name', async () => {
    process.env.VOICE_ALLOWED_SPACES = '!only-this:example.org';
    const { mx } = fakeClient([{ roomId: SPACE, isSpace: true, membership: 'invite' }]);
    assert.equal(await mayAcceptInvite(mx, SPACE), false);
  });

  it('refuses an ordinary room invite from someone whose room belongs to no served space', async () => {
    // The whole federation can send invites; this is what makes them meaningless on their own.
    const { mx } = fakeClient([
      { roomId: SPACE, isSpace: true, children: [] },
      { roomId: '!drive-by:example.org', membership: 'invite' },
    ]);
    assert.equal(await mayAcceptInvite(mx, '!drive-by:example.org'), false);
  });

  it('accepts a channel of a served space with no invite at all, since it can join restricted', async () => {
    const { mx } = fakeClient([{ roomId: SPACE, isSpace: true, children: [CHANNEL] }]);
    assert.equal(await mayAcceptInvite(mx, CHANNEL), true);
  });
});

describe('servedVoiceChannelIds', () => {
  const TEXT = '!text:example.org';

  it('lists the voice channels of a served space, and not its text channels', () => {
    const { mx } = fakeClient([{ roomId: SPACE, isSpace: true, children: [TEXT], voiceChildren: [CHANNEL] }]);
    assert.deepEqual(servedVoiceChannelIds(mx), [CHANNEL]);
  });

  it('skips a voice channel on another homeserver, like every other gate here', () => {
    const { mx } = fakeClient([{ roomId: SPACE, isSpace: true, voiceChildren: ['!voice:evil.example'] }]);
    assert.deepEqual(servedVoiceChannelIds(mx), []);
  });

  it('skips a space the bot has only been invited to', () => {
    const { mx } = fakeClient([{ roomId: SPACE, isSpace: true, membership: 'invite', voiceChildren: [CHANNEL] }]);
    assert.deepEqual(servedVoiceChannelIds(mx), []);
  });

  it('skips a space outside VOICE_ALLOWED_SPACES', () => {
    process.env.VOICE_ALLOWED_SPACES = '!other:example.org';
    const { mx } = fakeClient([{ roomId: SPACE, isSpace: true, voiceChildren: [CHANNEL] }]);
    assert.deepEqual(servedVoiceChannelIds(mx), []);
  });
});

// Room version 12 (what Continuwuity creates): room IDs are a bare hash with no server name, so a
// room's origin comes from its m.room.create sender. Reading it off the ID used to refuse every
// v12 voice channel and keep the bot out of every v12 Space.
describe('room version 12 (no server name in room IDs)', () => {
  const V12_SPACE = '!Q3pZkS8xV12spaceHash';
  const V12_VOICE = '!Lm9TqV12voiceHash';

  it('serves a v12 Space created on the bot’s own homeserver, and its v12 voice channels', async () => {
    const { mx } = fakeClient([
      { roomId: V12_SPACE, isSpace: true, creator: '@admin:example.org', voiceChildren: [V12_VOICE] },
    ]);
    assert.deepEqual([...servedSpaceIds(mx)], [V12_SPACE]);
    assert.deepEqual(servedVoiceChannelIds(mx), [V12_VOICE]);
    // The bot hasn't joined the channel yet, so its origin isn't known: the Space's claim decides.
    assert.equal(await isRoomServed(mx, V12_VOICE), true);
    assert.equal(await mayAcceptInvite(mx, V12_VOICE), true);
  });

  it('refuses a v12 room it knows was created on another homeserver, even if a served Space lists it', async () => {
    const { mx } = fakeClient([
      { roomId: V12_SPACE, isSpace: true, creator: '@admin:example.org', voiceChildren: [V12_VOICE] },
      { roomId: V12_VOICE, membership: 'invite', creator: '@mallory:elsewhere.net' },
    ]);
    assert.equal(await isRoomServed(mx, V12_VOICE), false);
    assert.equal(await mayAcceptInvite(mx, V12_VOICE), false);
    assert.deepEqual(servedVoiceChannelIds(mx), []);
  });

  it('never serves a v12 Space created elsewhere, even once the bot is in it', () => {
    const { mx } = fakeClient([{ roomId: V12_SPACE, isSpace: true, creator: '@admin:elsewhere.net', voiceChildren: [V12_VOICE] }]);
    assert.deepEqual([...servedSpaceIds(mx)], []);
  });
});

describe('confirmLocalOrigin', () => {
  it('answers from synced state when the creator is known', async () => {
    const { mx } = fakeClient([
      { roomId: '!local', creator: '@a:example.org' },
      { roomId: '!remote', creator: '@b:elsewhere.net' },
    ]);
    assert.equal(await confirmLocalOrigin(mx, '!local'), true);
    assert.equal(await confirmLocalOrigin(mx, '!remote'), false);
  });

  it('asks the homeserver right after a join, before the creator has synced', async () => {
    const { mx } = fakeClient([]);
    const state: Record<string, { type: string; sender: string }[]> = {
      '!fresh': [{ type: 'm.room.create', sender: '@a:example.org' }],
      '!fromElsewhere': [{ type: 'm.room.create', sender: '@b:elsewhere.net' }],
    };
    (mx as unknown as { roomState: (id: string) => Promise<unknown> }).roomState = async (id) => state[id] ?? [];
    assert.equal(await confirmLocalOrigin(mx, '!fresh'), true);
    assert.equal(await confirmLocalOrigin(mx, '!fromElsewhere'), false);
    assert.equal(await confirmLocalOrigin(mx, '!unreadable'), false);
  });
});
