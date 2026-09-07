import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Room as LivekitRoom } from 'livekit-client';
import { useWatchTogether } from './useWatchTogether';

const TOPIC = 'xyz.nekous.watch_together';

/** A minimal fake LiveKit Room: just enough event-emitter surface (`on`/`off`) plus a spied
 *  `localParticipant.publishData` to observe what the hook broadcasts, and a helper to simulate
 *  an incoming data message the way the real Room would deliver one. */
function fakeLivekitRoom() {
  const listeners = new Set<(...args: unknown[]) => void>();
  const publishData = vi.fn().mockResolvedValue(undefined);
  const room = {
    on: (_event: string, handler: (...args: unknown[]) => void) => {
      listeners.add(handler);
      return room;
    },
    off: (_event: string, handler: (...args: unknown[]) => void) => {
      listeners.delete(handler);
      return room;
    },
    localParticipant: { publishData },
  } as unknown as LivekitRoom;

  const emitData = (msg: unknown, topic = TOPIC) => {
    const payload = new TextEncoder().encode(JSON.stringify(msg));
    listeners.forEach((fn) => fn(payload, undefined, undefined, topic));
  };

  const lastBroadcast = (): unknown => {
    const calls = publishData.mock.calls;
    const call = calls[calls.length - 1];
    if (!call) return undefined;
    return JSON.parse(new TextDecoder().decode(call[0] as Uint8Array));
  };

  return { room, publishData, emitData, lastBroadcast };
}

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
