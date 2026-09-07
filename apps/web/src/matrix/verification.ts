import type { MatrixClient } from 'matrix-js-sdk';
import type { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';

/**
 * Starts an interactive (SAS emoji) verification request to this account's *other* devices —
 * the "planned follow-up" recovery.ts's own comment referred to. Requires at least one other
 * device to actually be online to accept it; the caller (RecoveryKeyPrompt.tsx) shows the
 * resulting request in VerificationSasModal, which drives the rest of the exchange.
 */
export function requestOwnDeviceVerification(mx: MatrixClient): Promise<VerificationRequest> {
  const crypto = mx.getCrypto();
  if (!crypto) {
    throw new Error('Encryption is not available on this session.');
  }
  return crypto.requestOwnUserVerification();
}

/**
 * Starts an interactive (SAS emoji) verification of *another user's* cross-signing identity —
 * the "highest form of trust" for someone who isn't you, per matrix-js-sdk's own
 * UserVerificationStatus docs. Sent as an in-room request (`m.key.verification.request` in a
 * DM), which is why UserProfileModal.tsx finds-or-creates a DM with them first, the same DM
 * their "Message" button would open.
 */
export function requestCrossUserVerification(mx: MatrixClient, userId: string, dmRoomId: string): Promise<VerificationRequest> {
  const crypto = mx.getCrypto();
  if (!crypto) {
    throw new Error('Encryption is not available on this session.');
  }
  return crypto.requestVerificationDM(userId, dmRoomId);
}
