import { useEffect, useState } from 'react';
import { decryptAttachment, type EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { useMatrixClient } from '../MatrixClientContext';
import { needsMediaAuthentication } from '../mediaAuth';

export type AttachmentSource = {
  /** Plain (unencrypted room) attachment: the raw `mxc://` URL. */
  url?: string;
  /** E2EE-encrypted attachment: per-file AES key/iv/hashes plus the `mxc://` URL to fetch. This
   *  is a *separate* layer from the room's own message encryption — the event content JSON is
   *  already decrypted by the time this sees it, but the attached file bytes need their own
   *  decrypt per the Matrix encrypted-attachments spec. */
  file?: EncryptedAttachmentInfo & { url: string };
  mimetype?: string;
};

// Fetching (and, for encrypted rooms, decrypting) every image from scratch on every mount —
// every room revisit, every page reload — was real, wasted, repeated work: network round trips
// plus real AES decryption CPU time, for bytes that hadn't changed. Cache the resolved blob URL
// per mxc URL for the life of the page/session instead of re-doing it each time.
const attachmentUrlCache = new Map<string, Promise<string>>();

async function fetchMxcBytes(mx: ReturnType<typeof useMatrixClient>, mxcUrl: string): Promise<ArrayBuffer> {
  const useAuth = await needsMediaAuthentication(mx);
  const httpUrl = mx.mxcUrlToHttp(mxcUrl, undefined, undefined, undefined, undefined, undefined, useAuth);
  if (!httpUrl) throw new Error('Invalid media URL');
  const res = await fetch(httpUrl, useAuth ? { headers: { Authorization: `Bearer ${mx.getAccessToken()}` } } : undefined);
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

async function resolveAttachment(
  mx: ReturnType<typeof useMatrixClient>,
  mxcUrl: string,
  source: AttachmentSource
): Promise<string> {
  const bytes = await fetchMxcBytes(mx, mxcUrl);
  const decrypted = source.file ? await decryptAttachment(bytes, source.file) : new Uint8Array(bytes);
  const blob = new Blob([decrypted], { type: source.mimetype });
  return URL.createObjectURL(blob);
}

/**
 * Resolves a message attachment's `url` (plain) or `file` (encrypted) into a usable src.
 * Always fetches the bytes itself rather than pointing an <img> at an mxc-derived HTTP URL —
 * that's required anyway for encrypted attachments, and it works uniformly on homeservers that
 * require authenticated media too. Deliberately fetches full size, not a thumbnail: encrypted
 * thumbnails are a separate `info.thumbnail_file` with its own key, and skipping that halves
 * the code path at the cost of downloading full images in the timeline — fine for now, worth
 * revisiting if bandwidth becomes a real complaint.
 */
export function useAttachmentUrl(source: AttachmentSource): string | null {
  const mx = useMatrixClient();
  const [src, setSrc] = useState<string | null>(null);
  const mxcUrl = source.file?.url ?? source.url;

  useEffect(() => {
    if (!mxcUrl) {
      setSrc(null);
      return undefined;
    }

    let cancelled = false;

    let cached = attachmentUrlCache.get(mxcUrl);
    if (!cached) {
      cached = resolveAttachment(mx, mxcUrl, source).catch((err: unknown) => {
        attachmentUrlCache.delete(mxcUrl); // don't poison the cache with a failed attempt
        throw err;
      });
      attachmentUrlCache.set(mxcUrl, cached);
    }

    cached
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });

    return () => {
      cancelled = true;
      // Deliberately not revoking the object URL here — it's cached and may be reused by
      // another mount of the same attachment (switching back to this room, another message
      // referencing the same file). Blob URLs accumulate for the page's lifetime as a result;
      // an LRU cap would be the next step if that ever proves to matter in practice.
    };
    // source.file is compared by its url above; the key/iv/hashes inside it are stable for a
    // given event so re-keying on mxcUrl (+ mx) alone is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, mxcUrl, source.mimetype]);

  return src;
}
