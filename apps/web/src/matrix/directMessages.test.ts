import { describe, expect, it } from 'vitest';
import { findExistingDirectMessageRoomId, isValidUserId } from './directMessages';

describe('isValidUserId', () => {
  it.each([
    '@alice:example.org',
    '@bob:matrix.org',
    '@a.b-c_d=e:sub.example.org',
    '@user:localhost',
  ])('accepts a well-formed Matrix ID: %s', (userId) => {
    expect(isValidUserId(userId)).toBe(true);
  });

  it.each([
    'alice:example.org', // missing leading @
    '@alice', // missing :domain
    '@:example.org', // empty localpart
    '@alice example.org', // whitespace instead of colon
    '',
    'not a matrix id at all',
  ])('rejects a malformed value: %s', (value) => {
    expect(isValidUserId(value)).toBe(false);
  });
});

type FakeMember = { userId: string };
type FakeRoom = { roomId: string; isSpaceRoom: () => boolean; getJoinedMembers: () => FakeMember[] };

function fakeClient(myUserId: string, rooms: FakeRoom[]) {
  return {
    getUserId: () => myUserId,
    getRooms: () => rooms,
  } as unknown as Parameters<typeof findExistingDirectMessageRoomId>[0];
}

function fakeRoom(roomId: string, memberIds: string[], isSpace = false): FakeRoom {
  return {
    roomId,
    isSpaceRoom: () => isSpace,
    getJoinedMembers: () => memberIds.map((userId) => ({ userId })),
  };
}

describe('findExistingDirectMessageRoomId', () => {
  it('finds a room with exactly the two of you joined', () => {
    const mx = fakeClient('@me:example.org', [fakeRoom('!dm:example.org', ['@me:example.org', '@them:example.org'])]);
    expect(findExistingDirectMessageRoomId(mx, '@them:example.org')).toBe('!dm:example.org');
  });

  it('ignores a group chat with more than two members', () => {
    const mx = fakeClient('@me:example.org', [
      fakeRoom('!group:example.org', ['@me:example.org', '@them:example.org', '@someone-else:example.org']),
    ]);
    expect(findExistingDirectMessageRoomId(mx, '@them:example.org')).toBeUndefined();
  });

  it('ignores Space rooms even if they happen to have two members', () => {
    const mx = fakeClient('@me:example.org', [fakeRoom('!space:example.org', ['@me:example.org', '@them:example.org'], true)]);
    expect(findExistingDirectMessageRoomId(mx, '@them:example.org')).toBeUndefined();
  });

  it('returns undefined when no DM with that user exists', () => {
    const mx = fakeClient('@me:example.org', [fakeRoom('!dm:example.org', ['@me:example.org', '@someone-else:example.org'])]);
    expect(findExistingDirectMessageRoomId(mx, '@them:example.org')).toBeUndefined();
  });
});
