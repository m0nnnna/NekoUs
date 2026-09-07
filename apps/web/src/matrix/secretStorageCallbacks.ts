import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api';

/**
 * `getSecretStorageKey`/`cacheSecretStorageKey` can only be supplied once, globally, at
 * `createClient()` time — the SDK invokes `getSecretStorageKey` whenever the crypto stack needs
 * the secret storage key, for either direction: *decrypting* an existing secret (the explicit,
 * user-initiated recovery-key restore flow in recovery.ts, which already has the decoded key in
 * hand before it calls into the crypto stack) or *encrypting* a new one during
 * `bootstrapSecretStorage()` — which, on brand-new-account setup, needs to encrypt the freshly
 * generated cross-signing/backup keys with the secret storage key it just created in that same
 * call. `cacheSecretStorageKey` is the SDK's own purpose-built hook for that second case: it's
 * called once, synchronously, right after the new key is created and before any of those
 * encrypting `getSecretStorageKey` calls happen — so implementing it here is enough to make both
 * directions share one small in-memory cache, rather than needing e2eeSetup.ts to know a keyId
 * that doesn't exist yet when it starts the call.
 *
 * Real bug this fixes: `getSecretStorageKey` originally had no `cacheSecretStorageKey`
 * counterpart, so it only ever returned non-null during a `withSecretStorageKeyAttempt`-wrapped
 * restore — registration's `bootstrapSecretStorage()` call never wrapped anything (it doesn't
 * know the keyId up front), so every encrypting call it made saw an empty cache and returned
 * `null`, surfacing to the user as an opaque `getSecretStorageKey callback returned falsey`
 * right after email verification, breaking new-account setup outright.
 */
let currentAttempt: { keyId: string; privateKey: Uint8Array } | null = null;

export function withSecretStorageKeyAttempt<T>(
  keyId: string,
  privateKey: Uint8Array,
  fn: () => Promise<T>
): Promise<T> {
  currentAttempt = { keyId, privateKey };
  return fn().finally(() => {
    currentAttempt = null;
  });
}

/** Drops the cached key from `cacheSecretStorageKey` once whatever needed it is done — the private
 *  key material otherwise sits in memory for the rest of the session for no further benefit. */
export function clearSecretStorageKeyAttempt(): void {
  currentAttempt = null;
}

export const secretStorageCallbacks: CryptoCallbacks = {
  getSecretStorageKey: async ({ keys }) => {
    if (!currentAttempt) return null;
    if (!(currentAttempt.keyId in keys)) return null;
    return [currentAttempt.keyId, currentAttempt.privateKey];
  },
  cacheSecretStorageKey: (keyId, _keyInfo, privateKey) => {
    currentAttempt = { keyId, privateKey };
  },
};
