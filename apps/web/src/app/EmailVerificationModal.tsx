import { useState, type FormEvent } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { Modal } from '../components/Modal';
import type { EmailVerification } from '../matrix/registration';

function randomClientSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

type Step = 'enter-email' | 'sending' | 'awaiting-code' | 'awaiting-link-click' | 'submitting-token';

type EmailVerificationModalProps = {
  mx: MatrixClient;
  onVerified: (result: EmailVerification) => void;
  onCancel: () => void;
};

/**
 * Synapse can be configured either way: hand back a `submit_url` for a "enter the code from
 * your email" flow, or just send a clickable confirmation link with no submit_url at all
 * (validated server-side when clicked). This handles both rather than assuming one.
 */
export function EmailVerificationModal({ mx, onVerified, onCancel }: EmailVerificationModalProps) {
  const [step, setStep] = useState<Step>('enter-email');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const [sid, setSid] = useState<string>();
  const [submitUrl, setSubmitUrl] = useState<string>();
  const [clientSecret] = useState(randomClientSecret);

  const handleSendEmail = async (evt: FormEvent) => {
    evt.preventDefault();
    if (!email.trim() || step === 'sending') return;
    setStep('sending');
    setError(undefined);
    try {
      const res = await mx.requestRegisterEmailToken(email.trim(), clientSecret, 1);
      setSid(res.sid);
      setSubmitUrl(res.submit_url);
      setStep(res.submit_url ? 'awaiting-code' : 'awaiting-link-click');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification email');
      setStep('enter-email');
    }
  };

  const handleSubmitToken = async (evt: FormEvent) => {
    evt.preventDefault();
    if (!sid || !submitUrl || !token.trim()) return;
    setStep('submitting-token');
    setError(undefined);
    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid, client_secret: clientSecret, token: token.trim() }),
      });
      const data = (await res.json()) as { success?: boolean };
      if (!res.ok || !data.success) {
        throw new Error("That code wasn't accepted — double-check it and try again.");
      }
      onVerified({ sid, clientSecret });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setStep('awaiting-code');
    }
  };

  return (
    <Modal title="Verify your email" onClose={onCancel}>
      {(step === 'enter-email' || step === 'sending') && (
        <form className="nu-modal-form" onSubmit={handleSendEmail}>
          <p>This server requires a verified email address to register.</p>
          <label className="nu-field">
            Email address
            <input
              className="nu-field__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
              disabled={step === 'sending'}
            />
          </label>
          {error && <p className="nu-field__error">{error}</p>}
          <div className="nu-form-actions">
            <button type="button" className="nu-button nu-button--secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="nu-button nu-button--primary" disabled={step === 'sending' || !email.trim()}>
              {step === 'sending' ? 'Sending…' : 'Send verification email'}
            </button>
          </div>
        </form>
      )}

      {(step === 'awaiting-code' || step === 'submitting-token') && (
        <form className="nu-modal-form" onSubmit={handleSubmitToken}>
          <p>
            We sent a code to <strong>{email}</strong>. Enter it below.
          </p>
          <label className="nu-field">
            Verification code
            <input
              className="nu-field__input"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoFocus
              required
              disabled={step === 'submitting-token'}
            />
          </label>
          {error && <p className="nu-field__error">{error}</p>}
          <div className="nu-form-actions">
            <button type="button" className="nu-button nu-button--secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="nu-button nu-button--primary"
              disabled={step === 'submitting-token' || !token.trim()}
            >
              {step === 'submitting-token' ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </form>
      )}

      {step === 'awaiting-link-click' && (
        <div className="nu-modal-form">
          <p>
            We sent a confirmation link to <strong>{email}</strong>. Click the link in that
            email, then continue here.
          </p>
          {error && <p className="nu-field__error">{error}</p>}
          <div className="nu-form-actions">
            <button type="button" className="nu-button nu-button--secondary" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="nu-button nu-button--primary"
              onClick={() => sid && onVerified({ sid, clientSecret })}
            >
              I've clicked the link — continue
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
