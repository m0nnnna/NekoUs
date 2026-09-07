import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { createRoom } from '../../matrix/roomCreation';

type CreateSpaceModalProps = {
  onClose: () => void;
  onCreated: (roomId: string) => void;
};

export function CreateSpaceModal({ onClose, onCreated }: CreateSpaceModalProps) {
  const mx = useMatrixClient();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const roomId = await createRoom(mx, { name: trimmedName, topic: topic.trim(), isPublic, isSpace: true });
      onCreated(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create space');
      setSubmitting(false);
    }
  };

  return (
    <Modal title="Create a Space" onClose={onClose}>
      <form className="nu-modal-form" onSubmit={handleSubmit}>
        <label className="nu-field">
          Name
          <input
            className="nu-field__input"
            data-nu-role="create-space-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="nu-field">
          Topic (optional)
          <textarea className="nu-field__textarea" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="nu-field__checkbox-row">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
          Public — anyone can find and join
        </label>
        {error && (
          <p className="nu-field__error" data-nu-role="create-space-error">
            {error}
          </p>
        )}
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="nu-button nu-button--primary" disabled={!name.trim() || submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
