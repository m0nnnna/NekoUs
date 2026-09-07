import { useEffect, useState } from 'react';
import { CryptoEvent, type VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { VerificationSasModal } from './VerificationSasModal';

/**
 * Mounted once (AppShell.tsx) so an already-trusted device can notice and respond when another
 * of your own sessions asks to verify — the receiving-side counterpart to
 * RecoveryKeyPrompt.tsx's "verify with another device" button, which is the initiating side.
 * Scoped to self-verification only: verifying *another user's* identity would need its own
 * trigger point (e.g. from UserProfileModal) and isn't covered by this pass.
 */
export function IncomingVerificationListener() {
  const mx = useMatrixClient();
  const [incoming, setIncoming] = useState<VerificationRequest | null>(null);

  useEffect(() => {
    const onRequest = (request: VerificationRequest) => {
      if (request.isSelfVerification) setIncoming(request);
    };
    mx.on(CryptoEvent.VerificationRequestReceived, onRequest);
    return () => {
      mx.removeListener(CryptoEvent.VerificationRequestReceived, onRequest);
    };
  }, [mx]);

  if (!incoming) return null;
  return <VerificationSasModal request={incoming} onClose={() => setIncoming(null)} />;
}
