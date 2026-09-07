/**
 * "Watch Together" — a shared video/YouTube session for a voice call, synced across every
 * participant via LiveKit's data channel (see useWatchTogether.ts) rather than actually routing
 * any media through LiveKit itself: each participant's own browser loads and plays the same
 * source independently, and only small JSON control messages (play/pause/seek/what's-playing)
 * cross the call. Sits in the same visual slot the screen share does, and only shows there when
 * nobody's actually sharing their screen (VoiceChannelPanel.tsx decides which one wins).
 */
export type WatchTogetherState = {
  kind: 'youtube' | 'media';
  /** The original URL, kept around to show/re-share — for YouTube this is redundant with
   *  `videoId` for playback purposes, but still worth keeping for display. */
  url: string;
  /** Only set for `kind: 'youtube'`. */
  videoId?: string;
  playing: boolean;
  /** Playback position, in seconds, as of `updatedAt` — see currentPositionSeconds for how a
   *  receiver extrapolates the *actual* current position from this, since some time has always
   *  passed between when this was sent and when it's read. */
  positionSeconds: number;
  updatedAt: number;
  /** LiveKit identity (a Matrix user ID) of whoever started this session — shown as "X started
   *  watching," not used to gate control: anyone in the call can play/pause/seek/stop, same as
   *  screen share has no separate "owner" permission either. */
  startedBy: string;
};

const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com']);

/**
 * Recognizes a YouTube URL (`watch?v=`, `youtu.be/`, or `/shorts/`) and extracts its video ID;
 * anything else that's a plain `http(s)://` URL is treated as a direct media URL, played with a
 * plain `<video>` element — no attempt to validate it's actually a playable media file ahead of
 * time, the same "trust it, fail visibly if it's wrong" approach the rest of this app takes for
 * user-supplied URLs (e.g. custom status links). Returns `null` for anything that isn't even a
 * well-formed http(s) URL at all.
 */
export function parseWatchUrl(input: string): { kind: 'youtube'; videoId: string } | { kind: 'media' } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\./, '');
  if (YOUTUBE_HOSTS.has(host)) {
    const v = url.searchParams.get('v');
    if (v) return { kind: 'youtube', videoId: v };
    const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]+)/);
    if (shortsMatch) return { kind: 'youtube', videoId: shortsMatch[1] };
    return null;
  }
  if (host === 'youtu.be') {
    const videoId = url.pathname.slice(1).split('/')[0];
    return videoId ? { kind: 'youtube', videoId } : null;
  }

  return { kind: 'media' };
}

/** A synced state is always a little stale by the time it's read (network delay, or just time
 *  passing since the last update) — extrapolates where playback actually is *right now* from the
 *  last known position and whether it was playing. */
export function currentPositionSeconds(state: WatchTogetherState, now: number = Date.now()): number {
  if (!state.playing) return state.positionSeconds;
  return state.positionSeconds + (now - state.updatedAt) / 1000;
}
