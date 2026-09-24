import { useEffect, useState, type ReactNode } from 'react';
import {
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
} from 'matrix-js-sdk/lib/crypto-api';
import { Modal } from '../../components/Modal';
import './VerificationSasModal.css';

/**
 * Drives one interactive SAS (emoji) verification exchange to completion — for a self
 * verification (RecoveryKeyPrompt.tsx's "verify with another device" button, or the receiving
 * side in IncomingVerificationListener.tsx) or a cross-user one (UserProfileModal.tsx's
 * "Verify" button). Both sides, and both kinds of request, render this same content — it
 * branches on `request.phase`/`initiatedByMe`/`isSelfVerification` to show the right step and
 * wording. QR-code verification isn't offered here — emoji SAS alone covers "prove this is who
 * it claims to be" without needing a camera or a second screen to display a code to.
 *
 * Exported separately from `VerificationSasModal` (which just wraps this in a `<Modal>`) so a
 * caller that's already inside its own Modal — UserProfileModal.tsx — can render the content
 * directly instead of nesting one Modal inside another.
 */
export function VerificationSasContent({
  request,
  onClose,
  onDone,
}: {
  request: VerificationRequest;
  onClose: () => void;
  onDone?: () => void;
}): ReactNode {
  const [, forceRender] = useState(0);
  const [sas, setSas] = useState<ShowSasCallbacks | null>(null);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const update = () => forceRender((n) => n + 1);
    request.on(VerificationRequestEvent.Change, update);
    return () => {
      request.off(VerificationRequestEvent.Change, update);
    };
  }, [request]);

  useEffect(() => {
    if (request.phase === VerificationPhase.Done) onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.phase]);

  // Once both sides are ready, kick off the SAS method — matrix-js-sdk's Rust crypto handles
  // the case where both sides call this at once (a documented spec tie-break), so no extra
  // "only the initiator starts it" coordination is needed here.
  useEffect(() => {
    if (request.phase === VerificationPhase.Ready && !request.verifier) {
      request.startVerification('m.sas.v1').catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to start verification');
      });
    }
  }, [request, request.phase]);

  useEffect(() => {
    const verifier = request.verifier;
    if (!verifier) return undefined;
    const onShowSas = (callbacks: ShowSasCallbacks) => setSas(callbacks);
    const onCancel = (e: unknown) => setError(e instanceof Error ? e.message : 'Verification was cancelled');
    verifier.on(VerifierEvent.ShowSas, onShowSas);
    verifier.on(VerifierEvent.Cancel, onCancel);
    verifier.verify().catch(() => {}); // failures/cancellation surface via the events above
    return () => {
      verifier.off(VerifierEvent.ShowSas, onShowSas);
      verifier.off(VerifierEvent.Cancel, onCancel);
    };
     
  }, [request, request.verifier]);

  const handleAccept = () => {
    request.accept().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to accept'));
  };

  const handleDecline = () => {
    void request.cancel().finally(onClose);
  };

  const handleConfirm = async () => {
    if (!sas || confirming) return;
    setConfirming(true);
    try {
      await sas.confirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm');
    } finally {
      setConfirming(false);
    }
  };

  const handleMismatch = () => {
    sas?.mismatch();
    setError("Codes didn't match — verification cancelled.");
  };

  const otherSide = request.isSelfVerification ? 'your other device' : 'the other person';

  if (error) {
    return (
      <p className="nu-field__error" data-nu-role="verification-error">
        {error}
      </p>
    );
  }
  if (request.phase === VerificationPhase.Cancelled) {
    return (
      <p className="nu-field__error" data-nu-role="verification-error">
        Verification was cancelled.
      </p>
    );
  }
  if (request.phase === VerificationPhase.Done) {
    return <p data-nu-role="verification-done">✅ Verified!</p>;
  }
  if (sas) {
    return (
      <div data-nu-role="verification-sas">
        <p>Confirm these match what's shown on the other side:</p>
        <div className="nu-verification-sas__emojis" data-nu-role="verification-sas-emojis">
          {sas.sas.emoji ? (
            sas.sas.emoji.map(([emoji, name], i) => (
              <div key={i} className="nu-verification-sas__emoji">
                <span className="nu-verification-sas__emoji-glyph">{emoji}</span>
                <span className="nu-verification-sas__emoji-name">{name}</span>
              </div>
            ))
          ) : (
            <div className="nu-verification-sas__decimal">{sas.sas.decimal?.join(' - ')}</div>
          )}
        </div>
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={handleMismatch}>
            Doesn't match
          </button>
          <button type="button" className="nu-button nu-button--primary" onClick={handleConfirm} disabled={confirming}>
            {confirming ? 'Confirming…' : 'They match'}
          </button>
        </div>
      </div>
    );
  }
  if (request.phase === VerificationPhase.Requested && !request.initiatedByMe) {
    return (
      <div data-nu-role="verification-incoming">
        <p>A verification request came in from {otherSide}. Accept it to continue?</p>
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={handleDecline}>
            Decline
          </button>
          <button type="button" className="nu-button nu-button--primary" onClick={handleAccept}>
            Accept
          </button>
        </div>
      </div>
    );
  }
  return <p className="nu-field__hint">Waiting for {otherSide}…</p>;
}

export function VerificationSasModal({
  request,
  onClose,
  onDone,
}: {
  request: VerificationRequest;
  onClose: () => void;
  onDone?: () => void;
}) {
  return (
    <Modal title="Verify" onClose={onClose}>
      <VerificationSasContent request={request} onClose={onClose} onDone={onDone} />
    </Modal>
  );
}
