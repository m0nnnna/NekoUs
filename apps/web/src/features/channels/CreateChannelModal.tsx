import { useState, type FormEvent } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import type { ChannelType } from '../../matrix/channelType';
import { createRoom } from '../../matrix/roomCreation';
import './CreateChannelModal.css';

type CreateChannelModalProps = {
  space: Room;
  onClose: () => void;
  onCreated: (roomId: string) => void;
};

export function CreateChannelModal({ space, onClose, onCreated }: CreateChannelModalProps) {
  const mx = useMatrixClient();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [channelType, setChannelType] = useState<ChannelType>('text');
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
      const roomId = await createRoom(mx, {
        name: trimmedName,
        topic: topic.trim(),
        isPublic,
        parentSpace: space,
        channelType,
      });
      onCreated(roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Create a channel in ${space.name}`} onClose={onClose}>
      <form className="nu-modal-form" onSubmit={handleSubmit}>
        <div className="nu-field">
          Channel type
          <div className="nu-channel-type-choice" data-nu-role="create-channel-type">
            <button
              type="button"
              className={
                channelType === 'text'
                  ? 'nu-channel-type-choice__option nu-channel-type-choice__option--active'
                  : 'nu-channel-type-choice__option'
              }
              onClick={() => setChannelType('text')}
            >
              # Text
            </button>
            <button
              type="button"
              className={
                channelType === 'voice'
                  ? 'nu-channel-type-choice__option nu-channel-type-choice__option--active'
                  : 'nu-channel-type-choice__option'
              }
              onClick={() => setChannelType('voice')}
            >
              🔊 Voice
            </button>
          </div>
        </div>
        <label className="nu-field">
          Channel name
          <input
            className="nu-field__input"
            data-nu-role="create-channel-name"
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
          <p className="nu-field__error" data-nu-role="create-channel-error">
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
