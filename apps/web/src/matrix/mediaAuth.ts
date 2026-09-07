import type { MatrixClient } from 'matrix-js-sdk';

const cache = new WeakMap<MatrixClient, Promise<boolean>>();

/**
 * Whether this homeserver requires authenticated media requests (MSC3916 / spec v1.11+) — a
 * plain `<img src="mxc-http-url">` can't attach the required Authorization header, so callers
 * that need this should fetch the bytes themselves and hand the browser an object URL instead.
 * Cached per-client since it only depends on the homeserver, not on any individual request.
 */
export function needsMediaAuthentication(mx: MatrixClient): Promise<boolean> {
  let cached = cache.get(mx);
  if (!cached) {
    cached = Promise.all([
      mx.isVersionSupported('v1.11').catch(() => false),
      mx.doesServerSupportUnstableFeature('org.matrix.msc3916.stable').catch(() => false),
    ]).then(([v1_11, msc3916]) => v1_11 || msc3916);
    cache.set(mx, cached);
  }
  return cached;
}
