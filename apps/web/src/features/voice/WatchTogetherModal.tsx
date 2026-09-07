import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';

/** Small "paste a link" prompt for starting a Watch Together session — see
 *  useWatchTogether.ts/watchTogether.ts for the actual sync mechanism and URL parsing. */
export function WatchTogetherModal({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (url: string) => boolean;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();

  const handleSubmit = (evt: FormEvent) => {
    evt.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!onStart(trimmed)) {
      setError("That doesn't look like a valid link.");
      return;
    }
    onClose();
  };

  return (
    <Modal title="Watch Together" onClose={onClose}>
      <form className="nu-modal-form" onSubmit={handleSubmit}>
        <label className="nu-field">
          YouTube or direct media link
          <input
            className="nu-field__input"
            data-nu-role="watch-together-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=… or https://example.com/video.mp4"
            autoFocus
            required
          />
        </label>
        <p className="nu-field__hint">
          Plays for everyone in the call, synced — no one has to share their screen for it.
        </p>
        {error && (
          <p className="nu-field__error" data-nu-role="watch-together-url-error">
            {error}
          </p>
        )}
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="nu-button nu-button--primary" disabled={!url.trim()}>
            Start
          </button>
        </div>
      </form>
    </Modal>
  );
}
