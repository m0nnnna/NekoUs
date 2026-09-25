import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Room as LivekitRoom } from 'livekit-client';
import { useWatchTogether } from './useWatchTogether';

const TOPIC = 'xyz.nekous.watch_together';

/** A minimal fake LiveKit Room: just enough event-emitter surface (`on`/`off`, per event, like
 *  the real one) plus a spied `localParticipant.publishData` to observe what the hook broadcasts,
 *  a connection state, and helpers to simulate an incoming data message or a connection. */
function fakeLivekitRoom({ connected = true }: { connected?: boolean } = {}) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const publishData = vi.fn().mockResolvedValue(undefined);
  const room = {
    state: connected ? 'connected' : 'connecting',
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return room;
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
      return room;
    },
    localParticipant: { publishData },
  } as unknown as LivekitRoom & { state: string };

  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args));
  const emitData = (msg: unknown, topic = TOPIC) => {
    const payload = new TextEncoder().encode(JSON.stringify(msg));
    emit('dataReceived', payload, undefined, undefined, topic);
  };
  const connect = () => {
    (room as { state: string }).state = 'connected';
    emit('connected');
  };

  const lastBroadcast = (): unknown => {
    const calls = publishData.mock.calls;
    const call = calls[calls.length - 1];
    if (!call) return undefined;
    return JSON.parse(new TextDecoder().decode(call[0] as Uint8Array));
  };

  return { room, publishData, emitData, lastBroadcast, connect };
}

describe('useWatchTogether at call level (mounted before the call connects)', () => {
  it('waits for the connection before asking what is playing', () => {
    const { room, publishData, lastBroadcast, connect } = fakeLivekitRoom({ connected: false });
    renderHook(() => useWatchTogether(room, '@me:example.org'));
    expect(publishData).not.toHaveBeenCalled();
    act(() => connect());
    expect(lastBroadcast()).toEqual({ type: 'request-sync' });
  });

  it('does not throw when a send fails mid-reconnect', async () => {
    const { room, publishData } = fakeLivekitRoom();
    publishData.mockRejectedValue(new Error('not connected'));
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));
    act(() => {
      result.current.start('https://example.com/video.mp4');
    });
    await Promise.resolve();
    expect(result.current.state?.url).toBe('https://example.com/video.mp4');
  });
});

describe('Listen together', () => {
  it('starts a listen session when asked', () => {
    const { room, lastBroadcast } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));
    act(() => {
      result.current.start('https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'listen');
    });
    expect(result.current.state).toMatchObject({ kind: 'youtube', videoId: 'dQw4w9WgXcQ', mode: 'listen' });
    expect(lastBroadcast()).toMatchObject({ type: 'state', state: { mode: 'listen' } });
  });

  it('always listens to an audio file, even from the Watch button', () => {
    const { room } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));
    act(() => {
      result.current.start('https://example.com/music/song.mp3', 'watch');
    });
    expect(result.current.state).toMatchObject({ kind: 'media', mode: 'listen' });
  });

  it('keeps the mode through play, pause and seek', () => {
    const { room } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));
    act(() => {
      result.current.start('https://example.com/song.ogg', 'listen');
    });
    act(() => result.current.pause());
    act(() => result.current.seek(42));
    act(() => result.current.play());
    expect(result.current.state).toMatchObject({ mode: 'listen', playing: true });
  });
});

describe('useWatchTogether', () => {
  it('asks the room what is currently playing as soon as it mounts', () => {
    const { room, lastBroadcast } = fakeLivekitRoom();
    renderHook(() => useWatchTogether(room, '@me:example.org'));
    expect(lastBroadcast()).toEqual({ type: 'request-sync' });
  });

  it('adopts state broadcast by another participant', () => {
    const { room, emitData } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));

    const state = {
      kind: 'media' as const,
      url: 'https://example.com/video.mp4',
      playing: true,
      positionSeconds: 5,
      updatedAt: Date.now(),
      startedBy: '@alice:example.org',
    };
    act(() => emitData({ type: 'state', state }));

    expect(result.current.state).toEqual(state);
  });

  it('ignores a data message on an unrelated topic', () => {
    const { room, emitData } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));

    act(() =>
      emitData(
        { type: 'state', state: { kind: 'media', url: 'x', playing: true, positionSeconds: 0, updatedAt: 0, startedBy: 'x' } },
        'some-other-topic'
      )
    );

    expect(result.current.state).toBeNull();
  });

  it('answers a request-sync with the current state, if it knows one', () => {
    const { room, emitData, publishData, lastBroadcast } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));

    act(() => result.current.start('https://example.com/video.mp4'));
    publishData.mockClear();

    act(() => emitData({ type: 'request-sync' }));

    expect(lastBroadcast()).toMatchObject({ type: 'state', state: { url: 'https://example.com/video.mp4' } });
  });

  it('does not answer a request-sync when nothing is playing', () => {
    const { room, emitData, publishData } = fakeLivekitRoom();
    renderHook(() => useWatchTogether(room, '@me:example.org'));
    publishData.mockClear();

    act(() => emitData({ type: 'request-sync' }));

    expect(publishData).not.toHaveBeenCalled();
  });

  it('start() broadcasts a fresh playing state from position 0, attributed to the caller', () => {
    const { room, lastBroadcast } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));

    let started = false;
    act(() => {
      started = result.current.start('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    expect(started).toBe(true);
    expect(lastBroadcast()).toMatchObject({
      type: 'state',
      state: { kind: 'youtube', videoId: 'dQw4w9WgXcQ', playing: true, positionSeconds: 0, startedBy: '@me:example.org' },
    });
  });

  it('start() rejects an unparseable URL without broadcasting anything', () => {
    const { publishData, room } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));
    publishData.mockClear();

    let started = true;
    act(() => {
      started = result.current.start('not a url');
    });

    expect(started).toBe(false);
    expect(result.current.state).toBeNull();
    expect(publishData).not.toHaveBeenCalled();
  });

  it('pause() freezes the extrapolated position rather than resetting it', () => {
    const { room } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));

    act(() => {
      result.current.start('https://example.com/video.mp4');
    });
    const startedAt = result.current.state!.updatedAt;

    vi.useFakeTimers();
    vi.setSystemTime(startedAt + 5000);
    act(() => result.current.pause());
    vi.useRealTimers();

    expect(result.current.state?.playing).toBe(false);
    expect(result.current.state?.positionSeconds).toBeCloseTo(5, 0);
  });

  it('stop() clears local state and tells everyone else to clear theirs too', () => {
    const { room, lastBroadcast } = fakeLivekitRoom();
    const { result } = renderHook(() => useWatchTogether(room, '@me:example.org'));

    act(() => result.current.start('https://example.com/video.mp4'));
    act(() => result.current.stop());

    expect(result.current.state).toBeNull();
    expect(lastBroadcast()).toEqual({ type: 'stop' });
  });
});
