import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import {
  clearVoiceServerConfig,
  livekitRoomName,
  readOwnVoiceServerConfig,
  setVoiceServerConfig,
} from './voice';
import { LIVEKIT_ROOM_NAME_VECTORS } from './livekitRoomName.vectors';

const VOICE_SERVER_EVENT = 'xyz.nekous.voice_server';

function fakeSpace(content: Record<string, unknown> | undefined): Room {
  return {
    roomId: '!space:example.org',
    currentState: {
      getStateEvents: (type: string) =>
        type === VOICE_SERVER_EVENT && content ? { getContent: () => content } : null,
    },
  } as unknown as Room;
}

describe('readOwnVoiceServerConfig', () => {
  it('reads the URLs and the service bot together', () => {
    const config = readOwnVoiceServerConfig(
      fakeSpace({
        url: 'wss://livekit.example.org',
        tokenEndpoint: 'https://voice.example.org/api/livekit/token',
        botUserId: '@bot:example.org',
      })
    );
    expect(config).toEqual({
      url: 'wss://livekit.example.org',
      tokenEndpoint: 'https://voice.example.org/api/livekit/token',
      botUserId: '@bot:example.org',
    });
  });

  it('still reads a Space configured before the bot field existed', () => {
    const config = readOwnVoiceServerConfig(
      fakeSpace({ url: 'wss://livekit.example.org', tokenEndpoint: 'https://voice.example.org/t' })
    );
    expect(config?.botUserId).toBeUndefined();
    expect(config?.url).toBe('wss://livekit.example.org');
  });

  it('treats a half-written config as no config at all', () => {
    expect(readOwnVoiceServerConfig(fakeSpace({ url: 'wss://livekit.example.org' }))).toBeUndefined();
    expect(readOwnVoiceServerConfig(fakeSpace({}))).toBeUndefined();
    expect(readOwnVoiceServerConfig(fakeSpace(undefined))).toBeUndefined();
  });
});

describe('clearVoiceServerConfig', () => {
  it('writes an empty content, which reads back as unconfigured', async () => {
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const mx = { sendStateEvent } as unknown as MatrixClient;
    await clearVoiceServerConfig(mx, fakeSpace({ url: 'wss://x', tokenEndpoint: 'https://y' }));
    expect(sendStateEvent).toHaveBeenCalledWith('!space:example.org', VOICE_SERVER_EVENT, {}, '');
    expect(readOwnVoiceServerConfig(fakeSpace({}))).toBeUndefined();
  });
});

describe('setVoiceServerConfig', () => {
  it('persists the bot ID alongside the URLs', async () => {
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const mx = { sendStateEvent } as unknown as MatrixClient;
    await setVoiceServerConfig(mx, fakeSpace(undefined), {
      url: 'wss://livekit.example.org',
      tokenEndpoint: 'https://voice.example.org/t',
      botUserId: '@bot:example.org',
    });
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!space:example.org',
      VOICE_SERVER_EVENT,
      expect.objectContaining({ botUserId: '@bot:example.org' }),
      ''
    );
  });
});

describe('livekitRoomName', () => {
  // The token server asserts its own copy of this function against an identical vector list
  // (services/token-server/src/livekitRoomName.vectors.ts), so a change here that isn't mirrored
  // there fails in one package or the other — rather than silently sending the two sides of a
  // call into differently named LiveKit rooms, which produces no error anywhere at all.
  LIVEKIT_ROOM_NAME_VECTORS.forEach(({ roomId, expected }) => {
    it(`derives ${expected} from ${roomId}`, () => {
      expect(livekitRoomName(roomId)).toBe(expected);
    });
  });

  it('never emits the base64 characters that are illegal in a LiveKit room name', () => {
    const name = livekitRoomName('!a/b+c?:example.org');
    expect(name).not.toMatch(/[+/=]/);
  });
});
