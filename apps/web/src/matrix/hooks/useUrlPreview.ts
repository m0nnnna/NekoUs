import { useEffect, useState } from 'react';
import type { IPreviewUrlResponse } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

// Keyed by url+bucketed-ts (matching the sdk's own 60s-bucketed cache key), same rationale as
// useMediaUrl's cache: the same link can appear in several messages/re-renders and a homeserver
// preview fetch is expensive enough (it fetches and parses the target page) to be worth sharing.
const previewCache = new Map<string, Promise<IPreviewUrlResponse | null>>();

/**
 * Wraps `mx.getUrlPreview` (MSC-less core Matrix `/media/preview_url` — server-side OpenGraph
 * unfurling, so no client-side CORS/scraping concerns). Resolves to `null` both while loading
 * and when the server has no preview for that link (unsupported site, fetch failure, or a
 * homeserver that doesn't implement the endpoint at all) — callers can't and don't need to tell
 * those apart, since either way the right UI is just "no card".
 */
export function useUrlPreview(url: string | undefined): IPreviewUrlResponse | null {
  const mx = useMatrixClient();
  const [preview, setPreview] = useState<IPreviewUrlResponse | null>(null);

  useEffect(() => {
    if (!url) {
      setPreview(null);
      return undefined;
    }
    let cancelled = false;
    setPreview(null);
    // Bucketed to the minute exactly like the sdk does internally, so our cache key matches its
    // own in-flight dedupe instead of missing it by a few milliseconds of Date.now() drift.
    const ts = Math.floor(Date.now() / 60000) * 60000;
    const key = `${ts}_${url}`;
    let cached = previewCache.get(key);
    if (!cached) {
      cached = mx.getUrlPreview(url, ts).catch(() => null);
      previewCache.set(key, cached);
    }
    cached.then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [mx, url]);

  return preview;
}
