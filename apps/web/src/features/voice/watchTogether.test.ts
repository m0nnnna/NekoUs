import { describe, expect, it } from 'vitest';
import { currentPositionSeconds, parseWatchUrl, type WatchTogetherState } from './watchTogether';

describe('parseWatchUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('recognizes a YouTube URL and extracts its video ID: %s', (url, videoId) => {
    expect(parseWatchUrl(url)).toEqual({ kind: 'youtube', videoId });
  });

  it('rejects a youtube.com URL with no video ID', () => {
    expect(parseWatchUrl('https://www.youtube.com/feed/subscriptions')).toBeNull();
  });

  it('treats a direct media URL as "media"', () => {
    expect(parseWatchUrl('https://example.com/video.mp4')).toEqual({ kind: 'media' });
  });

  it('treats any other well-formed http(s) URL as "media" too (trusted, not validated)', () => {
    expect(parseWatchUrl('https://example.com/stream.m3u8?token=abc')).toEqual({ kind: 'media' });
  });

  it.each(['', '   ', 'not a url', 'ftp://example.com/file.mp4', 'javascript:alert(1)'])(
    'rejects malformed or non-http(s) input: %s',
    (input) => {
      expect(parseWatchUrl(input)).toBeNull();
    }
  );
});

describe('currentPositionSeconds', () => {
  function fakeState(overrides: Partial<WatchTogetherState> = {}): WatchTogetherState {
    return {
      kind: 'media',
      url: 'https://example.com/video.mp4',
      playing: true,
      positionSeconds: 10,
      updatedAt: 1_000_000,
      startedBy: '@alice:example.org',
      ...overrides,
    };
  }

  it('returns the stored position unchanged when paused', () => {
    const state = fakeState({ playing: false, positionSeconds: 42 });
    expect(currentPositionSeconds(state, 1_010_000)).toBe(42);
  });

  it('extrapolates forward by elapsed time when playing', () => {
    const state = fakeState({ playing: true, positionSeconds: 10, updatedAt: 1_000_000 });
    // 5 real seconds later than updatedAt
    expect(currentPositionSeconds(state, 1_005_000)).toBe(15);
  });

  it('defaults "now" to Date.now() when not given explicitly', () => {
    const state = fakeState({ playing: false, positionSeconds: 7 });
    expect(currentPositionSeconds(state)).toBe(7);
  });
});
