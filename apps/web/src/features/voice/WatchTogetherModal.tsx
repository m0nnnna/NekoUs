import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { isAudioFileUrl, type WatchTogetherMode } from './watchTogether';

const COPY: Record<WatchTogetherMode, { title: string; label: string; placeholder: string; hint: string }> = {
  watch: {
    title: 'Watch Together',
    label: 'YouTube or direct video link',
    placeholder: 'https://www.youtube.com/watch?v=… or https://example.com/video.mp4',
    hint: 'Plays for everyone in the call, synced, in the call’s video area. No one has to share their screen.',
  },
  listen: {
    title: 'Listen Together',
    label: 'YouTube, YouTube Music, or direct audio link',
    placeholder: 'https://music.youtube.com/watch?v=… or https://example.com/song.mp3',
    hint:
      'Plays for everyone in the call, synced, from a small Now playing card by the call bar — it keeps ' +
      'going while you chat in other channels, and each person sets their own volume. YouTube links show a ' +
      'small player (YouTube requires one); audio files play with no picture.',
  },
};

/** "Paste a link" prompt for starting a shared session — see useWatchTogether.ts/watchTogether.ts
 *  for the sync mechanism and URL parsing. Opens on whichever mode its button asked for, and can
 *  switch; an audio file link is always listened to. */
export function WatchTogetherModal({
  onClose,
  onStart,
  initialMode = 'watch',
}: {
  onClose: () => void;
  onStart: (url: string, mode: WatchTogetherMode) => boolean;
  initialMode?: WatchTogetherMode;
}) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<WatchTogetherMode>(initialMode);
  const [error, setError] = useState<string>();
  const copy = COPY[mode];
  const audioFile = isAudioFileUrl(url);

  const handleSubmit = (evt: FormEvent) => {
    evt.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!onStart(trimmed, audioFile ? 'listen' : mode)) {
      setError("That doesn't look like a valid link.");
      return;
    }
    onClose();
  };

  return (
    <Modal title={copy.title} onClose={onClose}>
      <form className="nu-modal-form" onSubmit={handleSubmit}>
        <div className="nu-watch-together-mode" role="radiogroup" aria-label="How to share it">
          {(['watch', 'listen'] as const).map((option) => (
            <label key={option} className="nu-field__checkbox-row" data-nu-role={`watch-together-mode-${option}`}>
              <input type="radio" name="watch-together-mode" checked={mode === option} onChange={() => setMode(option)} />
              {option === 'watch' ? 'Watch together' : 'Listen together'}
            </label>
          ))}
        </div>
        <label className="nu-field">
          {copy.label}
          <input
            className="nu-field__input"
            data-nu-role="watch-together-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={copy.placeholder}
            autoFocus
            required
          />
        </label>
        <p className="nu-field__hint" data-nu-role="watch-together-hint">
          {audioFile && mode === 'watch' ? 'That’s an audio file, so it’ll be shared as Listen together. ' : ''}
          {copy.hint}
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
            {audioFile || mode === 'listen' ? 'Start listening' : 'Start watching'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
