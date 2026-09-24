import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MatrixClientContext } from '../matrix/MatrixClientContext';
import { useVoiceConnection } from '../matrix/hooks/useVoiceConnection';
import { startDemo } from './index';
import { DEMO_BOT_USER_ID } from './demoMode';
import { DEMO_ROOM_IDS } from './demoWorld';

/**
 * End-to-end exercise of the voice-bot self-heal through demo mode — `useVoiceConnection` and
 * `matrix/voiceBot.ts` run completely unmodified here, against the fake token server's real HTTP
 * shapes (409 `voice_bot_not_in_room` and all). This is the closest thing to a browser check of
 * that flow available without a LiveKit deployment: it proves the invite is actually sent, the
 * bot's join is actually noticed, and the retry loop actually recovers instead of erroring out.
 */

const realFetch = window.fetch;

let mx: ReturnType<typeof startDemo>;

beforeEach(() => {
  mx = startDemo();
});

afterEach(() => {
  window.fetch = realFetch;
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(MatrixClientContext.Provider, { value: mx }, children);
}

describe('demo voice flow', () => {
  it('invites the missing service bot and recovers once it joins', async () => {
    const afk = mx.getRoom(DEMO_ROOM_IDS.afk)!;
    expect(afk.getMember(DEMO_BOT_USER_ID)?.membership).toBeUndefined();

    const { result } = renderHook(() => useVoiceConnection(afk), { wrapper });
    void result.current.connect();

    // The bot gets invited as a precondition of the token request, not as a separate step.
    await waitFor(() => expect(afk.getMember(DEMO_BOT_USER_ID)?.membership).toBe('invite'));

    // While it hasn't acted on that invite, the UI says "setting up" rather than failing.
    await waitFor(() => expect(result.current.state.status).toBe('preparing'));

    // Once it joins, the retry gets past the membership check — which in demo mode means
    // reaching the point where only a real LiveKit server is missing.
    await waitFor(() => expect(afk.getMember(DEMO_BOT_USER_ID)?.membership).toBe('join'));
    await waitFor(
      () => {
        expect(result.current.state.status).toBe('error');
        if (result.current.state.status === 'error') {
          expect(result.current.state.message).toMatch(/Demo mode has no LiveKit/);
        }
      },
      { timeout: 8000 }
    );
  }, 15000);

  it('goes straight through for a channel the bot is already in', async () => {
    const lounge = mx.getRoom(DEMO_ROOM_IDS.lounge)!;
    expect(lounge.getMember(DEMO_BOT_USER_ID)?.membership).toBe('join');

    const { result } = renderHook(() => useVoiceConnection(lounge), { wrapper });
    void result.current.connect();

    // No invite, no 'preparing' detour — the membership check passes on the first request.
    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
      if (result.current.state.status === 'error') {
        expect(result.current.state.message).toMatch(/Demo mode has no LiveKit/);
      }
    });
  }, 10000);

  it('reports an unconfigured Space rather than attempting anything', async () => {
    const gameNight = mx.getRoom(DEMO_ROOM_IDS.gameNight)!;
    const { result } = renderHook(() => useVoiceConnection(gameNight), { wrapper });

    expect(result.current.voiceServer).toBeUndefined();
    void result.current.connect();

    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
      if (result.current.state.status === 'error') {
        expect(result.current.state.message).toMatch(/No voice server is configured/);
      }
    });
  });
});
