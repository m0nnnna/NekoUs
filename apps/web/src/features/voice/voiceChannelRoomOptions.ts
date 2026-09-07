/**
 * Shared LiveKit RoomOptions for voice/screen-share so the same codec and encoding
 * are used for the host and all viewers. H.264 for GPU-friendly decode on streamer
 * and viewer.
 *
 * Server has no GPU and does NOT transcode — it only forwards RTP. So no GPU
 * is needed on the server. Server CPU does packet crypto; high bitrate = more
 * packets. If your server is weak, set SERVER_MAX_BITRATE_CAP to limit load.
 *
 * Ported verbatim from cinny-voice.
 */
import type { AudioCaptureOptions, Room, RoomOptions } from 'livekit-client';

export const SCREEN_SHARE_CODEC = 'h264' as const;

/** Passed as `{ audio: SCREEN_SHARE_AUDIO_OPTIONS }` to `setScreenShareEnabled` — without an
 *  `audio` key at all, Chrome's own getDisplayMedia picker never even shows its "Share audio"
 *  checkbox, so screen shares could never include system/tab audio no matter what the user
 *  wanted (the actual bug this fixes). Echo cancellation/noise suppression/auto-gain are mic-
 *  input processing, not appropriate for system audio (music, game sound) — explicitly off so
 *  shared audio doesn't get run through voice-call DSP built for a microphone. The browser's own
 *  picker still lets the user leave the checkbox unticked per-share; this only makes the option
 *  exist at all. */
export const SCREEN_SHARE_AUDIO_OPTIONS: AudioCaptureOptions = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/** Optional cap (bps) so a weak server (no GPU, limited CPU) isn't overloaded by packet crypto. Undefined = no cap. */
export const SERVER_MAX_BITRATE_CAP: number | undefined = undefined; // e.g. 20_000_000 if server is the bottleneck

export const voiceChannelRoomOptions: RoomOptions = {
  publishDefaults: {
    videoCodec: SCREEN_SHARE_CODEC,
    screenShareEncoding: {
      maxBitrate: 8_000_000, // 8 Mbps baseline for 1080p@60 – encoder needs headroom to hit 60fps
      maxFramerate: 60,
      priority: 'high', // CPU/bandwidth priority in Chrome's congestion controller
      ...({ networkPriority: 'high' } as object), // DSCP packet scheduling priority (not in LiveKit type but passed to RTCRtpSendParameters)
    } as import('livekit-client').VideoEncoding,
  },
};

/** Jitter buffer target (ms) for screen share on the viewer. Keep small – a huge buffer queues frames and can cause the renderer to drop or stutter. */
export const SCREEN_SHARE_JITTER_BUFFER_TARGET_MS = 50;

/**
 * Set a larger jitter buffer target on the receiver for the given track so the viewer
 * buffers more before playing – reduces frame drops, adds delay. Optionally attach a
 * receiver transform that periodically requests keyframes (PLI); pass keyframeRequestPort
 * so the main thread can send { keyframeIntervalMs } to adapt to decoder load.
 * Returns the receiver so the caller can poll getStats() for dynamic adaptation.
 *
 * `Room.engine`'s subscriber peer connection has no direct `getReceivers()` in this LiveKit
 * version (cinny-voice's copy of this function targeted an older one that had it) — go through
 * `pcManager.subscriber.getTransceivers()` and read `.receiver` off each instead, which is the
 * same underlying RTCRtpReceiver set.
 */
export function setScreenShareJitterBufferTarget(
  room: Room,
  mediaStreamTrack: MediaStreamTrack | undefined,
  options?: { keyframeRequestWorker?: Worker; keyframeRequestPort?: MessagePort }
): RTCRtpReceiver | undefined {
  if (!mediaStreamTrack?.id) return undefined;
  try {
    const transceivers = room.engine?.pcManager?.subscriber?.getTransceivers?.() ?? [];
    const receiver = transceivers.map((t) => t.receiver).find((r) => r.track?.id === mediaStreamTrack.id);
    if (!receiver) return undefined;
    if ('jitterBufferTarget' in receiver) {
      (receiver as RTCRtpReceiver & { jitterBufferTarget: number }).jitterBufferTarget =
        SCREEN_SHARE_JITTER_BUFFER_TARGET_MS;
    }
    const worker = options?.keyframeRequestWorker;
    const port = options?.keyframeRequestPort;
    const RTCTransform =
      typeof globalThis !== 'undefined' &&
      (
        globalThis as unknown as {
          RTCRtpScriptTransform?: new (w: Worker, o?: object, t?: Transferable[]) => RTCRtpScriptTransform;
        }
      ).RTCRtpScriptTransform;
    if (worker && RTCTransform && 'transform' in receiver) {
      try {
        const transformOptions = port ? { port } : {};
        const transfer = port ? [port] : [];
        (receiver as RTCRtpReceiver & { transform?: unknown }).transform = new RTCTransform(
          worker,
          transformOptions,
          transfer
        );
      } catch {
        // ignore
      }
    }
    return receiver;
  } catch {
    return undefined;
  }
}

/**
 * Validate that the browser supports H.264 for receiving/decoding video (so screen
 * share from others uses hardware decode when possible). Logs a warning if not.
 * Call once when the voice room is used (e.g. on connect or before screen share).
 */
export function validateScreenShareCodecSupport(): void {
  if (typeof RTCRtpReceiver === 'undefined' || !RTCRtpReceiver.getCapabilities) return;
  try {
    const caps = RTCRtpReceiver.getCapabilities('video');
    const codecs = caps?.codecs ?? [];
    const hasH264 = codecs.some(
      (c) => c.mimeType?.toLowerCase() === 'video/h264' || c.mimeType?.toLowerCase() === 'video/avc'
    );
    if (!hasH264) {
      console.warn(
        '[voice] H.264 is not in the browser’s supported receive codecs. Screen share may fall back to VP8 (software decode, lower FPS).'
      );
    }
  } catch {
    // ignore
  }
}
