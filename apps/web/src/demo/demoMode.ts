/**
 * Demo mode — the whole app running against a fabricated, in-memory Matrix world, with no
 * homeserver, no LiveKit, and no network of any kind. Open the app with `?demo` (or click "Take
 * a look around" on the login screen) to enter it.
 *
 * What it's for: looking at and clicking through the UI — reviewing a theme (docs/theming.md),
 * checking a layout change, or showing someone what Purrlor is — without first deploying Synapse,
 * LiveKit, and a token server. It is NOT a test double for the real client: it fakes the
 * *transport*, not the behavior, so it can't tell you whether real sync, real E2EE, or a real
 * call works.
 *
 * This module is deliberately tiny and dependency-free: App.tsx imports only `isDemoMode` at
 * module scope, and pulls the actual world in through a dynamic `import()` afterwards, so none
 * of the demo data or fake client ends up in the main bundle for people running the real thing.
 */

/** Marks the fabricated homeserver, so demo IDs are recognisable on sight in the UI. */
export const DEMO_SERVER_NAME = 'demo.purrlor';

export const DEMO_USER_ID = `@you:${DEMO_SERVER_NAME}`;

/** The voice service account the demo's configured Space "runs" (see matrix/voiceBot.ts). */
export const DEMO_BOT_USER_ID = `@purrlor-voice-bot:${DEMO_SERVER_NAME}`;

/** Origin of the demo's fake token server. Never contacted — demoTokenServer.ts answers for it. */
export const DEMO_TOKEN_ORIGIN = 'https://token.demo.purrlor';

export const DEMO_TOKEN_ENDPOINT = `${DEMO_TOKEN_ORIGIN}/api/livekit/token`;

export const DEMO_LIVEKIT_URL = 'wss://livekit.demo.purrlor';

/**
 * Read from the URL rather than persisted anywhere: demo mode should never be something you can
 * end up in by accident, or stay in without noticing, and it must never collide with a real
 * stored session (it doesn't touch matrix/session.ts's keys at all).
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  const demo = new URLSearchParams(window.location.search).get('demo');
  return demo !== null && demo !== '0' && demo !== 'false';
}

/** Navigates into demo mode, preserving whatever else is in the query string. */
export function enterDemoMode(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('demo', '1');
  window.location.assign(url.toString());
}

/** Leaves demo mode — back to the ordinary login screen. */
export function exitDemoMode(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('demo');
  window.location.assign(url.toString());
}
