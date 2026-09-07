import { useEffect, useState } from 'react';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../MatrixClientContext';

/** Whether this user's cross-signing identity is verified — `null` while unknown/loading. See
 *  UserProfileModal.tsx's "Verify" button (matrix/verification.ts's cross-user counterpart to
 *  the self-verification flow in RecoveryKeyPrompt.tsx). */
export function useUserVerificationStatus(userId: string): boolean | null {
  const mx = useMatrixClient();
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const crypto = mx.getCrypto();
    if (!crypto) {
      setVerified(null);
      return undefined;
    }

    const refresh = () => {
      crypto
        .getUserVerificationStatus(userId)
        .then((status) => {
          if (!cancelled) setVerified(status.isVerified());
        })
        .catch(() => {
          if (!cancelled) setVerified(null);
        });
    };
    refresh();

    const onChanged = (changedUserId: string) => {
      if (changedUserId === userId) refresh();
    };
    mx.on(CryptoEvent.UserTrustStatusChanged, onChanged);

    return () => {
      cancelled = true;
      mx.removeListener(CryptoEvent.UserTrustStatusChanged, onChanged);
    };
  }, [mx, userId]);

  return verified;
}
