import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { VoiceServerConfig } from './voice';
import {
  ensureVoiceBotInvited,
  fetchVoiceBotUserId,
  isRoomOnBotHomeserver,
  serverNameOf,
  voiceBotPresence,
} from './voiceBot';

const BOT = '@purrlor-voice-bot:example.org';
const ME = '@me:example.org';

const config = (overrides: Partial<VoiceServerConfig> = {}): VoiceServerConfig => ({
  url: 'wss://livekit.example.org',
  tokenEndpoint: 'https://voice.example.org/api/livekit/token',
  botUserId: BOT,
  ...overrides,
});

function fakeRoom({
  botMembership,
  invitePowerLevel = 0,
  myPowerLevel = 0,
}: {
  botMembership?: string;
  invitePowerLevel?: number;
  myPowerLevel?: number;
}): Room {
  return {
    roomId: '!voice:example.org',
    getMember: (userId: string) => (userId === BOT && botMembership ? { membership: botMembership } : null),
    currentState: {
      getStateEvents: () => ({
        getContent: () => ({ invite: invitePowerLevel, users: { [ME]: myPowerLevel } }),
      }),
    },
  } as unknown as Room;
}

function fakeClient(invite = vi.fn().mockResolvedValue({})) {
  return {
    mx: { getUserId: () => ME, invite } as unknown as MatrixClient,
    invite,
  };
}

describe('voiceBotPresence', () => {
  it('treats a joined bot as present', () => {
    const { mx } = fakeClient();
    expect(voiceBotPresence(mx, fakeRoom({ botMembership: 'join' }), config())).toEqual({ status: 'present' });
  });

  it('treats an already-invited bot as present, so a second click does not re-invite it', () => {
    const { mx } = fakeClient();
    expect(voiceBotPresence(mx, fakeRoom({ botMembership: 'invite' }), config())).toEqual({ status: 'present' });
  });

  it('reports a bot that left (or was kicked) as missing', () => {
    const { mx } = fakeClient();
    expect(voiceBotPresence(mx, fakeRoom({ botMembership: 'leave' }), config())).toEqual({
      status: 'missing',
      canInvite: true,
    });
  });

  it('reports whether this user can actually do anything about a missing bot', () => {
    const { mx } = fakeClient();
    const room = fakeRoom({ invitePowerLevel: 50, myPowerLevel: 0 });
    expect(voiceBotPresence(mx, room, config())).toEqual({ status: 'missing', canInvite: false });
  });

  it('is unknown when the Space has no bot configured', () => {
    const { mx } = fakeClient();
    expect(voiceBotPresence(mx, fakeRoom({}), config({ botUserId: undefined }))).toEqual({ status: 'unknown' });
    expect(voiceBotPresence(mx, fakeRoom({}), undefined)).toEqual({ status: 'unknown' });
  });
});

describe('ensureVoiceBotInvited', () => {
  it('invites the bot into a channel it is not in', async () => {
    const { mx, invite } = fakeClient();
    await expect(ensureVoiceBotInvited(mx, fakeRoom({}), config())).resolves.toBe(true);
    expect(invite).toHaveBeenCalledWith('!voice:example.org', BOT);
  });

  it('does not re-invite a bot that is already there', async () => {
    const { mx, invite } = fakeClient();
    await expect(ensureVoiceBotInvited(mx, fakeRoom({ botMembership: 'join' }), config())).resolves.toBe(true);
    expect(invite).not.toHaveBeenCalled();
  });

  it('reports false when the bot is missing and this user cannot invite', async () => {
    const { mx, invite } = fakeClient();
    const room = fakeRoom({ invitePowerLevel: 50, myPowerLevel: 0 });
    await expect(ensureVoiceBotInvited(mx, room, config())).resolves.toBe(false);
    expect(invite).not.toHaveBeenCalled();
  });

  it('lets an unconfigured Space through, leaving the verdict to the token server', async () => {
    const { mx, invite } = fakeClient();
    await expect(ensureVoiceBotInvited(mx, fakeRoom({}), config({ botUserId: undefined }))).resolves.toBe(true);
    expect(invite).not.toHaveBeenCalled();
  });

  it('treats a failed invite as success when the bot turns out to already be in the room', async () => {
    // Two people clicking a brand-new voice channel at once: the loser of the race gets an
    // error describing a state that is, for its purposes, exactly what it wanted.
    const invite = vi.fn().mockRejectedValue(new Error('already in the room'));
    const mx = { getUserId: () => ME, invite } as unknown as MatrixClient;
    let botMembership: string | undefined;
    const room = {
      roomId: '!voice:example.org',
      getMember: (userId: string) => (userId === BOT && botMembership ? { membership: botMembership } : null),
      currentState: { getStateEvents: () => ({ getContent: () => ({ invite: 0, users: {} }) }) },
    } as unknown as Room;

    invite.mockImplementation(() => {
      botMembership = 'join'; // the other client's invite landed while ours was in flight
      return Promise.reject(new Error('already in the room'));
    });

    await expect(ensureVoiceBotInvited(mx, room, config())).resolves.toBe(true);
  });

  it('reports false when the invite genuinely fails', async () => {
    const invite = vi.fn().mockRejectedValue(new Error('server error'));
    const mx = { getUserId: () => ME, invite } as unknown as MatrixClient;
    await expect(ensureVoiceBotInvited(mx, fakeRoom({}), config())).resolves.toBe(false);
  });
});

describe('fetchVoiceBotUserId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the token server origin, not the token path itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ botUserId: BOT }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVoiceBotUserId('https://voice.example.org/api/livekit/token')).resolves.toBe(BOT);
    expect(fetchMock).toHaveBeenCalledWith('https://voice.example.org/api/livekit/config');
  });

  it('resolves undefined for a token server too old to answer, rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchVoiceBotUserId('https://voice.example.org/api/livekit/token')).resolves.toBeUndefined();
  });

  it('resolves undefined when the endpoint is unreachable or not a URL at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(fetchVoiceBotUserId('https://voice.example.org/api/livekit/token')).resolves.toBeUndefined();
    await expect(fetchVoiceBotUserId('not a url')).resolves.toBeUndefined();
  });
});

describe('isRoomOnBotHomeserver', () => {
  // The token server only serves rooms its own homeserver created, so a room from anywhere else
  // is refused no matter who invites the bot or how long the client waits. Checked client-side
  // because the round trip can only report the far more specific (and far more misleading)
  // "the bot isn't in the room yet".
  it('accepts a room created on the bot’s own homeserver', () => {
    expect(isRoomOnBotHomeserver('example.org', BOT)).toBe(true);
  });

  it('rejects a room a federated member created on theirs', () => {
    expect(isRoomOnBotHomeserver('other.example', BOT)).toBe(false);
  });

  it('accepts anything when there is no bot ID to compare against', () => {
    // An unknown answer is not a "no" — the token server still gets its say.
    expect(isRoomOnBotHomeserver('other.example', undefined)).toBe(true);
  });

  it('accepts a room whose origin is not known yet', () => {
    // A room-version-12 room ID names no server; until its creator is known, the token server
    // decides.
    expect(isRoomOnBotHomeserver(undefined, BOT)).toBe(true);
  });

  it('compares whole server names, ports included', () => {
    expect(serverNameOf('!voice:example.org:8448')).toBe('example.org:8448');
    expect(isRoomOnBotHomeserver('example.org:8448', '@bot:example.org')).toBe(false);
  });
});
