import { describe, expect, it } from 'vitest';
import type { SecretStorageKeyDescription } from 'matrix-js-sdk/lib/secret-storage';
import {
  clearSecretStorageKeyAttempt,
  secretStorageCallbacks,
  withSecretStorageKeyAttempt,
} from './secretStorageCallbacks';

// Only `algorithm` is ever read by the code under test (getSecretStorageKey just checks whether
// a key ID is present in the `keys` map, and cacheSecretStorageKey ignores its keyInfo argument
// entirely) — the rest of a real SecretStorageKeyDescriptionAesV1 (iv/mac/name/passphrase) is
// irrelevant here, hence the cast rather than a fully-populated fake.
function fakeKeyInfo(): SecretStorageKeyDescription {
  return { algorithm: 'm.secret_storage.v1.aes-hmac-sha2' } as unknown as SecretStorageKeyDescription;
}

describe('secretStorageCallbacks.getSecretStorageKey', () => {
  it('returns null when nothing has attempted or cached a key', async () => {
    clearSecretStorageKeyAttempt();
    const result = await secretStorageCallbacks.getSecretStorageKey?.(
      { keys: { keyA: fakeKeyInfo() } },
      'm.cross_signing.master'
    );
    expect(result).toBeNull();
  });

  it('returns the attempted key when withSecretStorageKeyAttempt is active (the restore-flow case)', async () => {
    const privateKey = new Uint8Array([1, 2, 3]);
    await withSecretStorageKeyAttempt('keyA', privateKey, async () => {
      const result = await secretStorageCallbacks.getSecretStorageKey?.(
        { keys: { keyA: fakeKeyInfo() } },
        'm.cross_signing.master'
      );
      expect(result).toEqual(['keyA', privateKey]);
    });
  });

  it('clears the attempted key once withSecretStorageKeyAttempt finishes', async () => {
    const privateKey = new Uint8Array([1, 2, 3]);
    await withSecretStorageKeyAttempt('keyA', privateKey, async () => {});
    const result = await secretStorageCallbacks.getSecretStorageKey?.(
      { keys: { keyA: fakeKeyInfo() } },
      'm.cross_signing.master'
    );
    expect(result).toBeNull();
  });

  it('returns the cached key after cacheSecretStorageKey fires (the new-account bootstrap case)', async () => {
    clearSecretStorageKeyAttempt();
    const privateKey = new Uint8Array([9, 9, 9]);
    // This is exactly what matrix-js-sdk's bootstrapSecretStorage calls right after creating a
    // brand-new secret storage key — before it goes on to store cross-signing/backup keys
    // encrypted with it, each of which calls getSecretStorageKey in turn.
    secretStorageCallbacks.cacheSecretStorageKey?.('newKeyId', fakeKeyInfo(), privateKey);

    const result = await secretStorageCallbacks.getSecretStorageKey?.(
      { keys: { newKeyId: fakeKeyInfo() } },
      'm.cross_signing.master'
    );
    expect(result).toEqual(['newKeyId', privateKey]);

    clearSecretStorageKeyAttempt();
  });

  it('returns null when the SDK asks about a key ID that was never attempted or cached', async () => {
    const privateKey = new Uint8Array([1, 2, 3]);
    await withSecretStorageKeyAttempt('keyA', privateKey, async () => {
      const result = await secretStorageCallbacks.getSecretStorageKey?.(
        { keys: { someOtherKey: fakeKeyInfo() } },
        'm.cross_signing.master'
      );
      expect(result).toBeNull();
    });
  });
});
