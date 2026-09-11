import { describe, expect, it, vi } from 'vitest';
import { EventType, JoinRule, Visibility, type MatrixClient, type Room } from 'matrix-js-sdk';
import { createRoom, getJoinRule, setJoinRule } from './roomCreation';

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

function fakeRoomWithJoinRule(joinRule?: JoinRule): Room {
  return {
    currentState: {
      getStateEvents: () =>
        joinRule === undefined ? null : { getContent: () => ({ join_rule: joinRule }) },
    },
  } as unknown as Room;
}

describe('getJoinRule', () => {
  it('reads the current join rule', () => {
    expect(getJoinRule(fakeRoomWithJoinRule(JoinRule.Public))).toBe(JoinRule.Public);
  });

  it('defaults to Invite when the room has no join_rules event', () => {
    expect(getJoinRule(fakeRoomWithJoinRule(undefined))).toBe(JoinRule.Invite);
  });
});

describe('setJoinRule', () => {
  it('sends only a join_rules state event, leaving directory visibility untouched', async () => {
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const mx = { sendStateEvent } as unknown as MatrixClient;
    await setJoinRule(mx, '!space:example.org', JoinRule.Public);
    expect(sendStateEvent).toHaveBeenCalledWith('!space:example.org', EventType.RoomJoinRules, {
      join_rule: JoinRule.Public,
    });
  });
});
