import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { createDirectMessage, isValidUserId } from '../../matrix/directMessages';

export function StartDmModal({ onClose, onCreated }: { onClose: () => void; onCreated: (roomId: string) => void }) {
  const mx = useMatrixClient();
  const [userId, setUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const trimmed = userId.trim();
    if (!trimmed || submitting) return;
    if (!isValidUserId(trimmed)) {
      setError('Enter a full Matrix ID, like @friend:example.com');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const roomId = await createDirectMessage(mx, trimmed);
      onCreated(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start the conversation');
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Start a Direct Message" onClose={onClose}>
      <form className="nu-modal-form" onSubmit={handleSubmit}>
        <label className="nu-field">
          Matrix ID
          <input
            className="nu-field__input"
            data-nu-role="start-dm-user-id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="@friend:example.com"
            autoFocus
            required
          />
          <span className="nu-field__hint">
            No user directory search yet — enter their exact Matrix ID (homeserver included).
          </span>
        </label>
        {error && (
          <p className="nu-field__error" data-nu-role="start-dm-error">
            {error}
          </p>
        )}
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="nu-button nu-button--primary" disabled={!userId.trim() || submitting}>
            {submitting ? 'Starting…' : 'Start'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
