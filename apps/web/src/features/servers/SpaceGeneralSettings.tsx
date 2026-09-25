import { useState, type FormEvent } from 'react';
import { EventType, type Room } from 'matrix-js-sdk';
import { Avatar } from '../../components/Avatar';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { updateRoomAvatar, updateRoomName, updateRoomTopic } from '../../matrix/roomCreation';
import { clearVoiceServerConfig, readOwnVoiceServerConfig, setVoiceServerConfig } from '../../matrix/voice';
import { ensureVoiceBotInvited, fetchVoiceBotUserId } from '../../matrix/voiceBot';

export function SpaceGeneralSettings({ space, onClose }: { space: Room; onClose: () => void }) {
  const mx = useMatrixClient();
  const [name, setName] = useState(space.name);
  const [topic, setTopic] = useState(
    space.currentState.getStateEvents(EventType.RoomTopic, '')?.getContent<{ topic?: string }>().topic ?? ''
  );
  // This Space's own config, deliberately *not* the inherited one a sub-space falls back to:
  // pre-filling from a parent and saving would silently pin a copy onto the child, so it stops
  // tracking the parent the moment anything else on this form is edited.
  const existingVoiceServer = readOwnVoiceServerConfig(space);
  const [voiceServerUrl, setVoiceServerUrlInput] = useState(existingVoiceServer?.url ?? '');
  const [tokenEndpoint, setTokenEndpoint] = useState(existingVoiceServer?.tokenEndpoint ?? '');
  const [botUserId, setBotUserId] = useState(existingVoiceServer?.botUserId ?? '');
  const [botLookup, setBotLookup] = useState<'idle' | 'checking' | 'unavailable'>('idle');
  // Which endpoint the bot ID currently in the box came from, so re-blurring an unchanged field
  // doesn't re-request, but pointing the form at a different token server does.
  const [resolvedFor, setResolvedFor] = useState(
    existingVoiceServer?.botUserId ? (existingVoiceServer.tokenEndpoint ?? '') : ''
  );
  const [avatarFile, setAvatarFile] = useState<File>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  /**
   * Asks the token server itself who its membership bot is, so this never has to be copied out
   * of the deployment's `.env` by hand — that ID is what lets new voice channels invite the bot
   * themselves instead of each one silently failing to connect. Runs on blur rather than on
   * every keystroke: it's a network call against a URL that's only meaningful once fully typed.
   */
  const lookUpBot = async () => {
    const endpoint = tokenEndpoint.trim();
    if (!endpoint || endpoint === resolvedFor) return;
    setBotLookup('checking');
    const found = await fetchVoiceBotUserId(endpoint);
    if (found) {
      setBotUserId(found);
      setResolvedFor(endpoint);
      setBotLookup('idle');
    } else {
      setBotLookup('unavailable');
    }
  };

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
      const trimmedBotUserId = botUserId.trim();

      if (trimmedUrl && trimmedTokenEndpoint) {
        if (
          trimmedUrl !== existingVoiceServer?.url ||
          trimmedTokenEndpoint !== existingVoiceServer?.tokenEndpoint ||
          trimmedBotUserId !== (existingVoiceServer?.botUserId ?? '')
        ) {
          tasks.push(
            setVoiceServerConfig(mx, space, {
              url: trimmedUrl,
              tokenEndpoint: trimmedTokenEndpoint,
              ...(trimmedBotUserId ? { botUserId: trimmedBotUserId } : {}),
            })
          );
        }
      } else if (!trimmedUrl && !trimmedTokenEndpoint && existingVoiceServer) {
        // Both fields emptied on a Space that had a config — previously a silent no-op, so
        // there was no way to turn voice back off (or to hand a sub-space back to its parent's
        // server) short of editing room state by hand.
        tasks.push(clearVoiceServerConfig(mx, space));
      }

      await Promise.all(tasks);

      // The Space itself is what the token server anchors "is this room one of ours" on: it
      // authorizes a voice channel only when a Space its bot has joined lists that channel as a
      // child (services/token-server/src/tenancy.ts). So the bot goes into the Space here, at
      // the one moment an admin is deliberately turning voice on, rather than being a step
      // documented somewhere nobody reads. Reported rather than swallowed — voice in this Space
      // does not work at all until it lands.
      if (trimmedUrl && trimmedTokenEndpoint && trimmedBotUserId) {
        const inSpace = await ensureVoiceBotInvited(mx, space, {
          url: trimmedUrl,
          tokenEndpoint: trimmedTokenEndpoint,
          botUserId: trimmedBotUserId,
        });
        if (!inSpace) {
          setError(
            `Voice settings saved, but ${trimmedBotUserId} could not be invited to this space — ` +
              'voice channels here will not connect until someone who can invite adds it.'
          );
          setSubmitting(false);
          return;
        }
      }

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
        <label className="nu-button nu-button--secondary nu-file-picker nu-space-settings__avatar-picker">
          {avatarFile ? avatarFile.name : 'Change avatar'}
          <input
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
          onBlur={lookUpBot}
          placeholder="https://example.com/api/livekit/token"
        />
        <span className="nu-field__hint">
          Both fields together are what voice channels in this space (and its sub-spaces)
          connect through — the LiveKit server itself and the token server that authorizes
          joining it. Clear both to turn voice off for this space.
        </span>
      </label>
      <label className="nu-field">
        Voice service account
        <input
          className="nu-field__input"
          data-nu-role="space-settings-voice-bot"
          value={botUserId}
          onChange={(e) => setBotUserId(e.target.value)}
          placeholder="@purrlor-voice-bot:example.com"
        />
        <span className="nu-field__hint" data-nu-role="space-settings-voice-bot-hint">
          {botLookup === 'checking'
            ? 'Asking the token server which account it uses…'
            : botLookup === 'unavailable'
              ? "Couldn't reach that token server to find this automatically — enter its bot account by hand (MATRIX_BOT_USER_ID in the deployment's .env)."
              : 'Filled in automatically from the token endpoint above. Saving invites this account to the space, which is what the voice server treats as permission to serve the channels inside it — and voice channels invite it too, since one it isn’t in can’t authorize anyone.'}
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
