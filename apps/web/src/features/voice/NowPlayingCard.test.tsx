import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { WatchTogetherState } from './watchTogether';
import { NowPlayingCard } from './NowPlayingCard';

const controls = {
  state: null as WatchTogetherState | null,
  start: vi.fn(() => true),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  stop: vi.fn(),
};
let deafened = false;
vi.mock('./watchTogetherContext', () => ({ useSharedWatchTogether: () => controls }));
vi.mock('./voiceCallContext', () => ({ useVoiceCall: () => ({ deafened }) }));

beforeAll(() => {
  // jsdom has no media playback.
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

const listening = (url: string): WatchTogetherState => ({
  kind: 'media',
  mode: 'listen',
  url,
  playing: true,
  positionSeconds: 0,
  updatedAt: Date.now(),
  startedBy: '@alice:x',
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  controls.state = null;
  deafened = false;
});

const q = (container: HTMLElement, role: string) => container.querySelector(`[data-nu-role="${role}"]`);

describe('NowPlayingCard', () => {
  it('plays an audio file with no picture, named after the file', () => {
    controls.state = listening('https://example.com/music/Night%20Drive.mp3');
    const { container } = render(<NowPlayingCard />);
    expect(q(container, 'now-playing-title')?.textContent).toBe('Night Drive.mp3');
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('https://example.com/music/Night%20Drive.mp3');
    expect(container.querySelector('video')).toBeNull();
  });

  it('is not shown for a Watch together session, or with nothing playing', () => {
    const { container, rerender } = render(<NowPlayingCard />);
    expect(q(container, 'now-playing')).toBeNull();
    controls.state = { ...listening('https://example.com/clip.mp4'), mode: 'watch' };
    rerender(<NowPlayingCard />);
    expect(q(container, 'now-playing')).toBeNull();
  });

  it('shares play, pause and stop with the whole call', () => {
    controls.state = listening('https://example.com/song.ogg');
    const { container } = render(<NowPlayingCard />);
    fireEvent.click(q(container, 'watch-together-play-pause')!);
    expect(controls.pause).toHaveBeenCalledOnce();
    fireEvent.click(q(container, 'watch-together-stop')!);
    expect(controls.stop).toHaveBeenCalledOnce();
  });

  it('applies your own volume, and goes silent when you deafen', () => {
    controls.state = listening('https://example.com/song.ogg');
    const { container, rerender } = render(<NowPlayingCard />);
    const audio = container.querySelector('audio')!;
    fireEvent.change(q(container, 'now-playing-volume')!, { target: { value: '0.3' } });
    expect(audio.volume).toBeCloseTo(0.3);
    expect(audio.muted).toBe(false);

    deafened = true;
    rerender(<NowPlayingCard />);
    expect(audio.muted).toBe(true);
    expect((q(container, 'now-playing-volume') as HTMLInputElement).disabled).toBe(true);
  });
});
