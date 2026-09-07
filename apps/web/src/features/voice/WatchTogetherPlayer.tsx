import { useEffect, useRef, useState } from 'react';
import { currentPositionSeconds, type WatchTogetherState } from './watchTogether';
import type { WatchTogetherControls } from './useWatchTogether';
import './WatchTogetherPlayer.css';

// The YouTube IFrame Player API has no official TypeScript types shipped with the package this
// app pins — same situation as screenShareKeyframeRequest.worker.ts's ambient Insertable Streams
// types, declared locally rather than pulled in from an extra dependency for a handful of calls.
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
};
/** YT.PlayerState values (the IFrame API only ever exposes these as bare numbers). */
const YT_PLAYING = 1;
const YT_BUFFERING = 3;
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string;
          playerVars?: Record<string, number>;
          events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;
/** Loads https://www.youtube.com/iframe_api once per page load and resolves once `window.YT` is
 *  actually usable — the script itself loads async and signals readiness via a global callback
 *  (YouTube's own API contract, not something we get to change), so every caller shares one
 *  promise rather than each mounting its own copy of the script tag. */
function loadYoutubeApi(): Promise<void> {
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise((resolve) => {
    if (window.YT) {
      resolve();
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

/** Formats a seconds count as `m:ss` / `h:mm:ss` for the seek bar's time readout. */
function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

type PlaybackInfo = { position: number; duration: number };

function YoutubePlayer({
  state,
  videoId,
  registerPlaybackInfo,
}: {
  state: WatchTogetherState;
  videoId: string;
  registerPlaybackInfo: (getInfo: () => PlaybackInfo) => void;
}) {
  // A *stable* wrapper React owns, plus a throwaway inner div created imperatively for the IFrame
  // API to consume — YouTube's own docs are explicit that it "will replace the specified element
  // with the <iframe>", i.e. it rips the given node out of the DOM entirely. Handing it our real
  // React-managed ref would leave that ref pointing at a detached node the moment a second video
  // gets loaded into the same component instance (changing videos re-runs this effect without
  // unmounting YoutubePlayer) — the next `new YT.Player(containerRef.current, ...)` would then
  // construct into a node that's no longer attached to anything visible. Routing through a
  // disposable inner div, and clearing the wrapper by hand on cleanup regardless of what state
  // the IFrame API left it in, keeps this component's own DOM node stable across video changes.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  // Set when we've asked the player to play but the browser's autoplay policy silently ignored
  // it (YouTube's IFrame API has no promise-rejection equivalent to <video>.play() for this —
  // onStateChange staying away from PLAYING/BUFFERING after a play attempt is the only signal).
  // Confirmed live: a fresh profile with no prior youtube.com engagement blocks this even though
  // the embed already carries `allow="autoplay"` and the session was started from a real click.
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | undefined;
    void loadYoutubeApi().then(() => {
      if (cancelled || !wrapperRef.current || !window.YT) return;
      const target = document.createElement('div');
      wrapperRef.current.appendChild(target);
      player = new window.YT.Player(target, {
        videoId,
        // controls: 0 and disablekb: 1 keep every participant funneled through this component's
        // own play/pause/seek bar instead of YouTube's native controls — otherwise a click on
        // YouTube's own UI would only affect that one person's view, with nothing to broadcast it.
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0 },
        events: {
          onReady: () => {
            playerRef.current = player ?? null;
            setReady(true);
          },
          onStateChange: (e) => {
            if (e.data === YT_PLAYING || e.data === YT_BUFFERING) setBlocked(false);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      player?.destroy();
      if (wrapperRef.current) wrapperRef.current.innerHTML = '';
      playerRef.current = null;
      setReady(false);
    };
    // Only the video ID should ever remount the embed — play/pause/seek are applied to the
    // existing player instance in the effect below instead of tearing it down and back up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (!ready) return;
    registerPlaybackInfo(() => ({
      position: playerRef.current?.getCurrentTime() ?? 0,
      duration: playerRef.current?.getDuration() ?? 0,
    }));
  }, [ready, registerPlaybackInfo]);

  useEffect(() => {
    const player = playerRef.current;
    if (!ready || !player) return;
    const target = currentPositionSeconds(state);
    if (Math.abs(player.getCurrentTime() - target) > 1.5) {
      player.seekTo(target, true);
    }
    if (state.playing) {
      player.playVideo();
      // A blocked autoplay attempt leaves the player silently paused/cued rather than throwing —
      // give it a moment to actually start (BUFFERING/PLAYING would clear `blocked` via
      // onStateChange above first) before concluding it needs a manual nudge.
      const timeout = setTimeout(() => {
        const s = player.getPlayerState();
        if (s !== YT_PLAYING && s !== YT_BUFFERING) setBlocked(true);
      }, 800);
      return () => clearTimeout(timeout);
    }
    player.pauseVideo();
    return undefined;
  }, [ready, state]);

  return (
    <div className="nu-watch-together__frame">
      <div ref={wrapperRef} className="nu-watch-together__youtube-target" />
      {blocked && (
        <button
          type="button"
          className="nu-watch-together__unblock"
          data-nu-role="watch-together-unblock"
          onClick={() => {
            playerRef.current?.playVideo();
            setBlocked(false);
          }}
        >
          ▶ Click to play
        </button>
      )}
    </div>
  );
}

function MediaPlayer({
  state,
  registerPlaybackInfo,
}: {
  state: WatchTogetherState;
  registerPlaybackInfo: (getInfo: () => PlaybackInfo) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    registerPlaybackInfo(() => ({
      position: videoRef.current?.currentTime ?? 0,
      duration: videoRef.current?.duration || 0,
    }));
  }, [registerPlaybackInfo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const target = currentPositionSeconds(state);
    if (Math.abs(video.currentTime - target) > 1.5) {
      video.currentTime = target;
    }
    if (state.playing) {
      video.play().then(
        () => setBlocked(false),
        () => setBlocked(true) // browser autoplay policy — needs a real user gesture to recover
      );
    } else {
      video.pause();
    }
  }, [state]);

  return (
    <div className="nu-watch-together__frame nu-watch-together__frame--media">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} src={state.url} className="nu-watch-together__video" />
      {blocked && (
        <button
          type="button"
          className="nu-watch-together__unblock"
          data-nu-role="watch-together-unblock"
          onClick={() => videoRef.current?.play().then(() => setBlocked(false))}
        >
          ▶ Click to play
        </button>
      )}
    </div>
  );
}

/**
 * Renders whichever kind of shared session is active plus one shared control bar (play/pause,
 * a seek slider) that drives sync for both — see useWatchTogether.ts for the actual
 * cross-participant sync mechanism this just calls into.
 */
export function WatchTogetherPlayer({
  state,
  controls,
}: {
  state: WatchTogetherState;
  controls: WatchTogetherControls;
}) {
  const getInfoRef = useRef<() => PlaybackInfo>(() => ({ position: 0, duration: 0 }));
  const [info, setInfo] = useState<PlaybackInfo>({ position: 0, duration: 0 });
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      if (scrubbing === null) setInfo(getInfoRef.current());
    }, 500);
    return () => clearInterval(id);
  }, [scrubbing]);

  // A duration of 0 (not loaded yet) would otherwise make the seek bar's range collapse to
  // nothing right as playback starts — floor it so the bar stays usable during that gap.
  const duration = Math.max(info.duration, info.position, 1);

  return (
    <div className="nu-watch-together" data-nu-role="watch-together">
      {state.kind === 'youtube' && state.videoId ? (
        <YoutubePlayer
          state={state}
          videoId={state.videoId}
          registerPlaybackInfo={(fn) => (getInfoRef.current = fn)}
        />
      ) : (
        <MediaPlayer state={state} registerPlaybackInfo={(fn) => (getInfoRef.current = fn)} />
      )}
      <div className="nu-watch-together__controls" data-nu-role="watch-together-controls">
        <button
          type="button"
          className="nu-watch-together__play-pause"
          data-nu-role="watch-together-play-pause"
          onClick={() => (state.playing ? controls.pause() : controls.play())}
        >
          {state.playing ? '⏸' : '▶'}
        </button>
        <span className="nu-watch-together__time">
          {formatTime(scrubbing ?? info.position)} / {formatTime(duration)}
        </span>
        <input
          type="range"
          className="nu-watch-together__seek"
          data-nu-role="watch-together-seek"
          min={0}
          max={duration}
          step={1}
          value={scrubbing ?? info.position}
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onMouseUp={() => {
            if (scrubbing !== null) controls.seek(scrubbing);
            setScrubbing(null);
          }}
          onTouchEnd={() => {
            if (scrubbing !== null) controls.seek(scrubbing);
            setScrubbing(null);
          }}
        />
        <button
          type="button"
          className="nu-watch-together__stop"
          data-nu-role="watch-together-stop"
          title="Stop watching together"
          onClick={controls.stop}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
