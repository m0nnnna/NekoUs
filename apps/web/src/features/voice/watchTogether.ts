/**
 * "Watch Together" — a shared video/YouTube session for a voice call, synced across every
 * participant via LiveKit's data channel (see useWatchTogether.ts) rather than actually routing
 * any media through LiveKit itself: each participant's own browser loads and plays the same
 * source independently, and only small JSON control messages (play/pause/seek/what's-playing)
 * cross the call.
 *
 * Two ways to share, one session at a time per call:
 * - **Watch together** sits in the same visual slot the screen share does, and only shows there
 *   when nobody's actually sharing their screen (VoiceChannelPanel.tsx decides which one wins).
 * - **Listen together** is for music and anything else where the picture isn't the point: a
 *   compact "Now playing" card beside the call bar (NowPlayingCard.tsx), which keeps playing while
 *   you move around other channels. A direct audio file plays with no picture at all. A YouTube
 *   link still shows a small player: YouTube's API terms forbid separating a video's audio from
 *   its picture, and its embeds must stay at least 200×200 — so "listen" means small and out of
 *   the way, never hidden.
 */
export type WatchTogetherMode = 'watch' | 'listen';

export type WatchTogetherState = {
  kind: 'youtube' | 'media';
  /** Absent in sessions started by clients from before Listen together existed — those are watch
   *  sessions (see sessionMode). */
  mode?: WatchTogetherMode;
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

/** Which way a session is shared. A session with no mode came from an older client: watch. */
export function sessionMode(state: WatchTogetherState): WatchTogetherMode {
  return state.mode === 'listen' ? 'listen' : 'watch';
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);

const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba)$/i;

/** A direct link to an audio file — nothing to watch, so it's always shared as Listen together. */
export function isAudioFileUrl(input: string): boolean {
  try {
    return AUDIO_EXTENSIONS.test(new URL(input.trim()).pathname);
  } catch {
    return false;
  }
}

/** What to call a direct-media session: the file's name, decoded, or the host as a fallback. */
export function mediaTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    let file = segment;
    try {
      file = decodeURIComponent(segment);
    } catch {
      // A malformed escape in someone's link: show it as it is.
    }
    return file || parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Recognizes a YouTube URL (`watch?v=` — including YouTube Music's — `youtu.be/`, `/shorts/`,
 * `/live/` or `/embed/`) and extracts its video ID; anything else that's a plain `http(s)://` URL
 * is treated as a direct media URL, played with a plain `<video>` or `<audio>` element — no
 * attempt to validate it's actually a playable media file ahead of time, the same "trust it, fail
 * visibly if it's wrong" approach the rest of this app takes for user-supplied URLs (e.g. custom
 * status links). Returns `null` for anything that isn't even a well-formed http(s) URL at all.
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
    const pathMatch = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/);
    if (pathMatch) return { kind: 'youtube', videoId: pathMatch[1] };
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
