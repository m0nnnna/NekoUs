/**
 * Receiver encoded transform: pass through screen share video frames and periodically
 * request keyframes (PLI). Interval can be updated from main thread via options.port
 * so we can go "demanding" (faster recovery) when viewer stats show stress.
 *
 * Ported verbatim from cinny-voice.
 */
const DEFAULT_KEYFRAME_REQUEST_INTERVAL_MS = 2000;

// Worker-scope Insertable Streams types (RTCRtpScriptTransform spec) — not shipped in
// TypeScript's DOM lib since they're experimental/worker-global-only, unlike the
// window-side `RTCRtpScriptTransform` constructor type which TS does declare. This file
// has no import/export so TS treats it as a global script, not a module — top-level
// interface declarations merge straight into the global scope without `declare global`.
interface RTCRtpScriptTransformer {
  readonly options: unknown;
  readonly readable: ReadableStream;
  readonly writable: WritableStream;
}
interface RTCTransformEvent extends Event {
  readonly transformer: RTCRtpScriptTransformer;
}

// TS resolves `addEventListener` against the Window overload (this file's tsconfig lib is
// DOM, not webworker) which knows nothing about 'rtctransform' — cast past it, same escape
// hatch used elsewhere in this codebase for APIs TS's bundled lib doesn't cover.
addEventListener('rtctransform', ((event: RTCTransformEvent) => {
  const transformer = event.transformer;
  const options = transformer.options as { port?: MessagePort };
  let keyframeIntervalMs = DEFAULT_KEYFRAME_REQUEST_INTERVAL_MS;
  let lastRequest = 0;

  if (options?.port) {
    options.port.onmessage = (e: MessageEvent<{ keyframeIntervalMs?: number }>) => {
      const ms = e.data?.keyframeIntervalMs;
      if (typeof ms === 'number' && ms > 0) keyframeIntervalMs = ms;
    };
  }

  const transform = new TransformStream({
    transform(encodedFrame: RTCEncodedVideoFrame | RTCEncodedAudioFrame, controller: TransformStreamDefaultController) {
      controller.enqueue(encodedFrame);
      if (typeof (transformer as RTCRtpScriptTransformer & { sendKeyFrameRequest?: () => Promise<void> }).sendKeyFrameRequest !== 'function') return;
      const now = Date.now();
      if (now - lastRequest >= keyframeIntervalMs) {
        lastRequest = now;
        (transformer as RTCRtpScriptTransformer & { sendKeyFrameRequest: () => Promise<void> }).sendKeyFrameRequest().catch(() => {});
      }
    },
  });

  transformer.readable.pipeThrough(transform).pipeTo(transformer.writable);
}) as EventListener);
