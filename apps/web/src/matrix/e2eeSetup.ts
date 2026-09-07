import { AuthType, MatrixError, type IAuthData, type MatrixClient } from 'matrix-js-sdk';
import type { UIAuthCallback } from 'matrix-js-sdk/lib/interactive-auth';
import { clearSecretStorageKeyAttempt } from './secretStorageCallbacks';

/**
 * First-time E2EE setup for a brand-new account: cross-signing plus secret storage/key backup,
 * generating a *new* recovery key (as opposed to src/matrix/recovery.ts, which restores from an
 * *existing* one on a new session of an already-set-up account — different mechanism, different
 * moment). Returns the human-readable recovery key to show the user — this is the only time
 * it's ever available; it isn't retrievable again afterward.
 */
export async function bootstrapNewAccountEncryption(
  mx: MatrixClient,
  userId: string,
  password: string
): Promise<string> {
  const crypto = mx.getCrypto();
  if (!crypto) {
    throw new Error('Encryption is not available on this session.');
  }

  // Uploading the new cross-signing keys can itself require re-authenticating (UIA) — we still
  // have the password from registration, so satisfy it automatically rather than prompting again.
  const authUploadDeviceSigningKeys: UIAuthCallback<void> = async (makeRequest) => {
    try {
      await makeRequest(null);
    } catch (err) {
      if (err instanceof MatrixError && err.data) {
        const uia = err.data as IAuthData;
        await makeRequest({
          type: AuthType.Password,
          identifier: { type: 'm.id.user', user: userId },
          password,
          session: uia.session,
        });
      } else {
        throw err;
      }
    }
  };

  await crypto.bootstrapCrossSigning({ setupNewCrossSigning: true, authUploadDeviceSigningKeys });

  let encodedRecoveryKey: string | undefined;
  try {
    await crypto.bootstrapSecretStorage({
      setupNewKeyBackup: true,
      setupNewSecretStorage: true,
      createSecretStorageKey: async () => {
        const generated = await crypto.createRecoveryKeyFromPassphrase();
        encodedRecoveryKey = generated.encodedPrivateKey;
        return generated;
      },
    });
  } finally {
    // secretStorageCallbacks.cacheSecretStorageKey stashes the just-created key's private bytes
    // in module state so bootstrapSecretStorage's own encrypting getSecretStorageKey calls (for
    // the cross-signing/backup keys it stores right after creating this one) can find it — drop
    // that cache now that this call is done rather than leaving it sitting in memory.
    clearSecretStorageKeyAttempt();
  }

  if (!encodedRecoveryKey) {
    throw new Error('Failed to generate a recovery key.');
  }
  return encodedRecoveryKey;
}
