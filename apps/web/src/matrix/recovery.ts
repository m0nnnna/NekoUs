import {
  decodeRecoveryKey,
  deriveRecoveryKeyFromPassphrase,
  type KeyBackupRestoreResult,
} from 'matrix-js-sdk/lib/crypto-api';
import { SecretStorage, type MatrixClient } from 'matrix-js-sdk';
import { withSecretStorageKeyAttempt } from './secretStorageCallbacks';

export class RecoveryKeyError extends Error {}

/**
 * Decodes whatever the user typed into the actual secret storage private key. Matrix accounts
 * can set up secret storage two ways: a randomly-generated base58 recovery key (the "4-5
 * characters then a space" format), or a user-chosen recovery passphrase run through PBKDF2
 * (arbitrary text — however long or "custom" the user picked). Which one applies is recorded
 * on the key's own metadata (`passphrase` present = passphrase-derived), not something to guess
 * or make the user pick between.
 */
async function decodeUserInput(
  input: string,
  keyInfo: SecretStorage.SecretStorageKeyDescriptionAesV1
): Promise<Uint8Array> {
  if (keyInfo.passphrase) {
    const { salt, iterations, bits } = keyInfo.passphrase;
    return deriveRecoveryKeyFromPassphrase(input, salt, iterations, bits);
  }
  try {
    return decodeRecoveryKey(input);
  } catch {
    throw new RecoveryKeyError("That recovery key doesn't look right — check for typos.");
  }
}

/**
 * Restores decryption ability for historical encrypted messages using a Matrix recovery
 * key/passphrase via the spec's Secure Secret Storage and Backup mechanism. Non-interactive:
 * it works standalone, without another logged-in device present. SAS/QR device-to-device
 * verification is a better UX for establishing trust and is planned as a follow-up — this
 * covers "I have my recovery key, unlock my history" in the meantime.
 */
export async function restoreFromRecoveryKey(
  mx: MatrixClient,
  input: string
): Promise<KeyBackupRestoreResult> {
  const crypto = mx.getCrypto();
  if (!crypto) {
    throw new RecoveryKeyError('Encryption is not available on this session.');
  }

  const keyTuple = await mx.secretStorage.getKey();
  if (!keyTuple) {
    throw new RecoveryKeyError('This account has no recovery key set up.');
  }
  const [keyId, keyInfo] = keyTuple;

  const privateKey = await decodeUserInput(input.trim(), keyInfo);

  const isCorrect = await mx.secretStorage.checkKey(privateKey, keyInfo);
  if (!isCorrect) {
    throw new RecoveryKeyError(
      keyInfo.passphrase
        ? "That recovery passphrase doesn't match — double-check it and try again."
        : "That recovery key doesn't match — double-check it and try again."
    );
  }

  try {
    return await withSecretStorageKeyAttempt(keyId, privateKey, async () => {
      await crypto.bootstrapSecretStorage({});
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      return crypto.restoreKeyBackup();
    });
  } catch {
    throw new RecoveryKeyError('Unlocked secret storage, but restoring message history failed. Try again.');
  }
}
