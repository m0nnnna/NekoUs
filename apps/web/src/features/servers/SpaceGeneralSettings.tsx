import { useState, type FormEvent } from 'react';
import { EventType, type Room } from 'matrix-js-sdk';
import { Avatar } from '../../components/Avatar';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { updateRoomAvatar, updateRoomName, updateRoomTopic } from '../../matrix/roomCreation';
import { readVoiceServerConfig, setVoiceServerConfig } from '../../matrix/voice';

export function SpaceGeneralSettings({ space, onClose }: { space: Room; onClose: () => void }) {
  const mx = useMatrixClient();
  const [name, setName] = useState(space.name);
  const [topic, setTopic] = useState(
    space.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent<{ topic?: string }>().topic ?? ''
  );
  const existingVoiceServer = readVoiceServerConfig(mx, space);
  const [voiceServerUrl, setVoiceServerUrlInput] = useState(existingVoiceServer?.url ?? '');
  const [tokenEndpoint, setTokenEndpoint] = useState(existingVoiceServer?.tokenEndpoint ?? '');
  const [avatarFile, setAvatarFile] = useState<File>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const tasks: Promise<void>[] = [];
      if (avatarFile) tasks.push(updateRoomAvatar(mx, space.roomId, avatarFile));
      const trimmedName = name.trim();
      if (trimmedName && trimmedName !== space.name) tasks.push(updateRoomName(mx, space.roomId, trimmedName));
      tasks.push(updateRoomTopic(mx, space.roomId, topic.trim()));

      const trimmedUrl = voiceServerUrl.trim();
      const trimmedTokenEndpoint = tokenEndpoint.trim();
      if (
        trimmedUrl &&
        trimmedTokenEndpoint &&
        (trimmedUrl !== existingVoiceServer?.url || trimmedTokenEndpoint !== existingVoiceServer?.tokenEndpoint)
      ) {
        tasks.push(setVoiceServerConfig(mx, space, { url: trimmedUrl, tokenEndpoint: trimmedTokenEndpoint }));
      }

      await Promise.all(tasks);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
      setSubmitting(false);
    }
  };

  return (
    <form className="nu-modal-form" onSubmit={handleSubmit}>
      <div className="nu-space-settings__avatar-row">
        <Avatar name={name || space.name} mxcUrl={avatarFile ? null : space.getMxcAvatarUrl()} size={56} />
        <label className="nu-button nu-button--secondary nu-space-settings__avatar-picker">
          {avatarFile ? avatarFile.name : 'Change avatar'}
          <input
            className="nu-space-settings__avatar-input"
            type="file"
            accept="image/*"
            onChange={(e) => setAvatarFile(e.target.files?.[0])}
          />
        </label>
      </div>
      <label className="nu-field">
        Name
        <input className="nu-field__input" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="nu-field">
        Topic
        <textarea className="nu-field__textarea" value={topic} onChange={(e) => setTopic(e.target.value)} />
      </label>
      <label className="nu-field">
        Voice server (LiveKit URL)
        <input
          className="nu-field__input"
          value={voiceServerUrl}
          onChange={(e) => setVoiceServerUrlInput(e.target.value)}
          placeholder="wss://livekit.example.com"
        />
      </label>
      <label className="nu-field">
        Voice token endpoint
        <input
          className="nu-field__input"
          value={tokenEndpoint}
          onChange={(e) => setTokenEndpoint(e.target.value)}
          placeholder="https://example.com/api/livekit/token"
        />
        <span className="nu-field__hint">
          Both fields together are what voice channels in this space (and its sub-spaces)
          connect through — the LiveKit server itself and the token server that authorizes
          joining it.
        </span>
      </label>
      {error && (
        <p className="nu-field__error" data-nu-role="space-settings-error">
          {error}
        </p>
      )}
      <div className="nu-form-actions">
        <button type="button" className="nu-button nu-button--secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="nu-button nu-button--primary" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
