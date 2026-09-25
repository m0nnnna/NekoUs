/**
 * Per-deployment settings read at page load from `/config.json`, which the web container writes
 * at startup from its environment (apps/web/deploy/40-purrlor-config.sh) — so one built image can
 * be locked to a different homeserver per deployment without a rebuild, the same property the
 * rest of this bundle keeps (see apps/web/Dockerfile's top comment).
 *
 * Absent (the Vite dev server, or a deployment that sets nothing), every field is undefined and
 * the app behaves exactly as it always has: the login and register screens ask for a homeserver.
 */
export type RuntimeConfig = {
  /** When set, the login and register screens use this homeserver and don't offer to change it.
   *  A base URL (`https://matrix.example.com`) or a server name resolved via .well-known. */
  homeserver?: string;
};

let config: RuntimeConfig = {};

export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  if (!raw || typeof raw !== 'object') return {};
  const homeserver = (raw as Record<string, unknown>).homeserver;
  return typeof homeserver === 'string' && homeserver.trim() ? { homeserver: homeserver.trim() } : {};
}

/** Never throws: a missing or malformed config.json just means "no deployment overrides". The
 *  dev server answers /config.json with index.html (SPA fallback), which lands here as a JSON
 *  parse failure and is treated the same way. */
export async function loadRuntimeConfig(): Promise<void> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    config = res.ok ? parseRuntimeConfig(await res.json()) : {};
  } catch {
    config = {};
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  return config;
}

/** How a locked homeserver is shown to the user — the host, not the full URL. */
export function homeserverDisplayName(homeserver: string): string {
  try {
    return /^https?:\/\//i.test(homeserver) ? new URL(homeserver).host : homeserver;
  } catch {
    return homeserver;
  }
}
