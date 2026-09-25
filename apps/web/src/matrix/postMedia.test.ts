// @vitest-environment node
// Node's Blob and WebCrypto are the real ones the encryption round trip needs; jsdom's Blob has no
// arrayBuffer(). Nothing in this file touches the DOM.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { decryptAttachment } from 'browser-encrypt-attachment';
import type { MatrixClient } from 'matrix-js-sdk';
import {
  fitWithin,
  formatBytes,
  mediaKindOf,
  readAttachments,
  shouldConvertToWebp,
  uploadPostMedia,
  webpName,
} from './postMedia';

describe('mediaKindOf', () => {
  it('accepts the formats posts support', () => {
    expect(mediaKindOf('image/jpeg')).toBe('image');
    expect(mediaKindOf('image/png')).toBe('image');
    expect(mediaKindOf('image/gif')).toBe('image');
    expect(mediaKindOf('image/webp')).toBe('image');
    expect(mediaKindOf('video/webm')).toBe('video');
    expect(mediaKindOf('video/mp4')).toBe('video');
  });

  it('rejects everything else', () => {
    expect(mediaKindOf('image/svg+xml')).toBeUndefined();
    expect(mediaKindOf('application/pdf')).toBeUndefined();
  });
});

describe('shouldConvertToWebp', () => {
  it('re-encodes only still JPEG and PNG', () => {
    expect(shouldConvertToWebp('image/jpeg')).toBe(true);
    expect(shouldConvertToWebp('image/png')).toBe(true);
  });

  it('leaves animated and already-compact formats alone', () => {
    expect(shouldConvertToWebp('image/gif')).toBe(false);
    expect(shouldConvertToWebp('image/webp')).toBe(false);
    expect(shouldConvertToWebp('video/webm')).toBe(false);
  });
});

describe('fitWithin', () => {
  it('leaves an image that already fits', () => {
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });

  it('scales the longest edge down, keeping the aspect ratio', () => {
    expect(fitWithin(5120, 2880)).toEqual({ w: 2560, h: 1440 });
    expect(fitWithin(1000, 4000, 2000)).toEqual({ w: 500, h: 2000 });
  });
});

describe('webpName', () => {
  it('swaps the extension', () => {
    expect(webpName('photo.JPG')).toBe('photo.webp');
    expect(webpName('screen.shot.png')).toBe('screen.shot.webp');
    expect(webpName('noext')).toBe('noext.webp');
  });
});

describe('readAttachments', () => {
  const good = { kind: 'image', url: 'mxc://x/a', name: 'a.webp', info: { mimetype: 'image/webp', size: 10 } };

  it('keeps well-formed attachments', () => {
    expect(readAttachments([good])).toEqual([good]);
  });

  it('drops malformed ones: non-mxc URLs, wrong kinds, unsupported types', () => {
    expect(
      readAttachments([
        { ...good, url: 'https://evil.example/a.webp' },
        { ...good, kind: 'video' },
        { ...good, info: { mimetype: 'image/svg+xml', size: 1 } },
        null,
        'nope',
      ])
    ).toEqual([]);
  });

  it('caps a post at four', () => {
    expect(readAttachments([good, good, good, good, good])).toHaveLength(4);
  });

  it('keeps an encrypted attachment that carries its key', () => {
    const encrypted = {
      kind: 'image',
      name: 'a.webp',
      info: { mimetype: 'image/webp', size: 10 },
      file: { url: 'mxc://x/cipher', key: { k: 'secret', alg: 'A256CTR' }, iv: 'iv', hashes: { sha256: 'h' }, v: 'v2' },
    };
    expect(readAttachments([encrypted])).toEqual([encrypted]);
  });

  it('drops an encrypted attachment missing its key, or carrying a plain URL beside it', () => {
    const file = { url: 'mxc://x/cipher', key: { k: 'secret' }, iv: 'iv', hashes: { sha256: 'h' } };
    const base = { kind: 'image', name: 'a.webp', info: { mimetype: 'image/webp', size: 10 } };
    expect(readAttachments([{ ...base, file: { ...file, key: {} } }])).toEqual([]);
    expect(readAttachments([{ ...base, file, url: 'mxc://x/plain' }])).toEqual([]);
  });

  it('treats anything that isn’t an array as no attachments', () => {
    expect(readAttachments(undefined)).toEqual([]);
    expect(readAttachments({})).toEqual([]);
  });
});

describe('formatBytes', () => {
  it('reads naturally', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('uploadPostMedia', () => {
  beforeAll(() => {
    // browser-encrypt-attachment reaches WebCrypto through `window.crypto`; Node's global has the
    // same WebCrypto, just not under that name.
    (globalThis as { window?: unknown }).window ??= globalThis;
  });

  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const media = { file: new Blob([bytes], { type: 'image/webp' }), name: 'cat.webp', kind: 'image' as const, mimetype: 'image/webp', w: 2, h: 1 };

  function fakeClient() {
    const uploadContent = vi.fn(async (_body: Blob, _opts: object) => ({ content_uri: 'mxc://x/uploaded' }));
    return { mx: { uploadContent } as unknown as MatrixClient, uploadContent };
  }

  it('uploads plainly for a public place', async () => {
    const { mx, uploadContent } = fakeClient();
    const attachment = await uploadPostMedia(mx, media, { encrypt: false });
    expect(attachment).toEqual({ kind: 'image', url: 'mxc://x/uploaded', name: 'cat.webp', info: { mimetype: 'image/webp', size: 8, w: 2, h: 1 } });
    expect(uploadContent.mock.calls[0][1]).toEqual({ name: 'cat.webp', type: 'image/webp' });
  });

  it('encrypts for a private place: the server gets anonymous ciphertext, the post gets the key', async () => {
    const { mx, uploadContent } = fakeClient();
    const attachment = await uploadPostMedia(mx, media, { encrypt: true });

    // No plain URL, no filename or type sent with the upload.
    expect(attachment.url).toBeUndefined();
    expect(attachment.file?.url).toBe('mxc://x/uploaded');
    expect(uploadContent.mock.calls[0][1]).toEqual({ type: 'application/octet-stream', includeFilename: false });

    // What was uploaded isn't the image, and the key in the post turns it back into the image.
    const uploaded = new Uint8Array(await (uploadContent.mock.calls[0][0] as Blob).arrayBuffer());
    expect(Array.from(uploaded)).not.toEqual(Array.from(bytes));
    const decrypted = new Uint8Array(await decryptAttachment(uploaded.buffer, attachment.file!));
    expect(Array.from(decrypted)).toEqual(Array.from(bytes));
  });
});
