import { useState, type FormEvent } from 'react';
import type { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { RecoveryKeyError, restoreFromRecoveryKey } from '../../matrix/recovery';
import { requestOwnDeviceVerification } from '../../matrix/verification';
import { VerificationSasModal } from './VerificationSasModal';
import './RecoveryKeyPrompt.css';

/**
 * Backup-code-based decryption recovery — see docs on `restoreFromRecoveryKey` — plus the
 * interactive (SAS emoji) device-verification alternative recovery.ts's own comment flagged as
 * a follow-up: verifying against another already-trusted device of yours lets matrix-js-sdk's
 * Rust crypto gossip the backup key over automatically, without typing anything.
 */
export function RecoveryKeyPrompt({ onResolved }: { onResolved: () => void }) {
  const mx = useMatrixClient();
  const [dismissed, setDismissed] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<{ imported: number; total: number }>();
  const [verificationRequest, setVerificationRequest] = useState<VerificationRequest>();
  const [verificationError, setVerificationError] = useState<string>();

  if (dismissed) return null;

  const handleStartDeviceVerification = async () => {
    setVerificationError(undefined);
    try {
      setVerificationRequest(await requestOwnDeviceVerification(mx));
    } catch (err) {
      setVerificationError(err instanceof Error ? err.message : 'Failed to start verification');
    }
  };

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    setRestoring(true);
    setError(undefined);
    try {
      const res = await restoreFromRecoveryKey(mx, recoveryKey);
      setResult({ imported: res.imported, total: res.total });
      setTimeout(onResolved, 1500);
    } catch (err) {
      setError(err instanceof RecoveryKeyError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="nu-recovery-prompt" data-nu-role="recovery-prompt">
      <form className="nu-recovery-prompt__panel" onSubmit={handleSubmit}>
        <h2 className="nu-recovery-prompt__title">Unlock message history</h2>
        <p className="nu-recovery-prompt__body">
          This is a new session, so past encrypted messages won't decrypt yet. Enter your
          recovery key or recovery passphrase (whichever was set up for this account) to
          restore them.
        </p>
        <input
          className="nu-recovery-prompt__input"
          data-nu-role="recovery-prompt-input"
          value={recoveryKey}
          onChange={(e) => setRecoveryKey(e.target.value)}
          placeholder="Recovery key or passphrase"
          autoComplete="off"
          autoFocus
        />
        {error && (
          <p className="nu-recovery-prompt__error" data-nu-role="recovery-prompt-error">
            {error}
          </p>
        )}
        {result && (
          <p className="nu-recovery-prompt__success" data-nu-role="recovery-prompt-success">
            Restored {result.imported} of {result.total} keys.
          </p>
        )}
        {verificationError && (
          <p className="nu-recovery-prompt__error" data-nu-role="recovery-prompt-verification-error">
            {verificationError}
          </p>
        )}
        <button
          type="button"
          className="nu-recovery-prompt__verify-instead"
          data-nu-role="recovery-prompt-verify-device"
          onClick={handleStartDeviceVerification}
        >
          Or verify with another device instead
        </button>
        <div className="nu-recovery-prompt__actions">
          <button type="button" className="nu-recovery-prompt__skip" onClick={() => setDismissed(true)}>
            Skip for now
          </button>
          <button
            type="submit"
            className="nu-recovery-prompt__submit"
            disabled={!recoveryKey.trim() || restoring}
          >
            {restoring ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </form>
      {verificationRequest && (
        <VerificationSasModal
          request={verificationRequest}
          onClose={() => setVerificationRequest(undefined)}
          onDone={onResolved}
        />
      )}
    </div>
  );
}
