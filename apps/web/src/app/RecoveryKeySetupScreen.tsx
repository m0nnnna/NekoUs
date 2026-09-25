import { useState } from 'react';
import './RecoveryKeySetupScreen.css';

type RecoveryKeySetupScreenProps = {
  recoveryKey: string;
  onContinue: () => void;
};

/**
 * Shown once, right after a brand-new account finishes registering — the only time this key is
 * ever available. Deliberately not skippable without an explicit confirmation checkbox: losing
 * this key AND all your devices means encrypted history is gone for good, with nobody (not
 * Purrlor, not a homeserver admin) able to recover it.
 */
export function RecoveryKeySetupScreen({ recoveryKey, onContinue }: RecoveryKeySetupScreenProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch {
      // Clipboard access can be denied by the browser — the key is still visible/selectable
      // either way, so this isn't fatal, just a missed convenience.
    }
  };

  return (
    <div className="nu-recovery-setup" data-nu-role="recovery-setup-screen">
      <div className="nu-recovery-setup__panel">
        <h1 className="nu-recovery-setup__title">Save your recovery key</h1>

        <div className="nu-recovery-setup__warning" data-nu-role="recovery-setup-warning">
          <strong>This is the only way to recover your encrypted messages</strong> if you ever
          lose access to all of your devices. Nobody else can recover it for you — not Purrlor,
          not your homeserver's admin, nobody. Lose this key and lose your devices at the same
          time, and your message history is gone for good.
        </div>

        <div className="nu-recovery-setup__key" data-nu-role="recovery-setup-key">
          {recoveryKey}
        </div>

        <button type="button" className="nu-button nu-button--secondary" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy to clipboard'}
        </button>

        <div className="nu-recovery-setup__advice">
          <p>Store it somewhere durable and private — for example:</p>
          <ul>
            <li>A password manager (1Password, Bitwarden, etc.)</li>
            <li>Printed out and kept somewhere safe, the way you'd treat a spare house key</li>
            <li>A secure note kept somewhere other than just this one device</li>
          </ul>
          <p>
            <strong>It will not be shown again</strong> once you continue.
          </p>
        </div>

        <label className="nu-recovery-setup__confirm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I've saved my recovery key somewhere safe
        </label>

        <button
          type="button"
          className="nu-button nu-button--primary"
          data-nu-role="recovery-setup-continue"
          disabled={!confirmed}
          onClick={onContinue}
        >
          Continue to Purrlor
        </button>
      </div>
    </div>
  );
}
