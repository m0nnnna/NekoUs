import { useEffect, useState } from 'react';
import { useMatrixClient } from '../MatrixClientContext';

export type RecoveryStatus = 'checking' | 'not-needed' | 'needed';

/**
 * Whether this session should prompt for a recovery key to unlock historical encrypted
 * messages: there's a server-side key backup, but this session doesn't yet hold/trust its
 * decryption key locally (`matchesDecryptionKey`) — the exact condition under which old
 * messages will show "[unable to decrypt]".
 */
export function useRecoveryStatus(): RecoveryStatus {
  const mx = useMatrixClient();
  const [status, setStatus] = useState<RecoveryStatus>('checking');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const crypto = mx.getCrypto();
      if (!crypto) {
        if (!cancelled) setStatus('not-needed');
        return;
      }
      try {
        const backupInfo = await crypto.getKeyBackupInfo();
        if (!backupInfo) {
          if (!cancelled) setStatus('not-needed');
          return;
        }
        const trust = await crypto.isKeyBackupTrusted(backupInfo);
        if (!cancelled) setStatus(trust.matchesDecryptionKey ? 'not-needed' : 'needed');
      } catch {
        if (!cancelled) setStatus('not-needed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mx]);

  return status;
}
