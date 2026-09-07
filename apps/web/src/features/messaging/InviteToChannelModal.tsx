import { useState, type FormEvent } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Modal } from '../../components/Modal';
import { isValidUserId } from '../../matrix/directMessages';
import { inviteMember } from '../../matrix/moderation';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import './InviteToChannelModal.css';

/**
 * Invites a Matrix ID into this one channel — Space membership (SpaceMembersSettings.tsx)
 * doesn't cascade to child rooms, so a service account like the voice token-server's bot (see
 * docs/voice-architecture.md) or a member who should only see one specific channel needs a
 * separate, room-scoped invite. `inviteMember` is already fully generic (matrix/moderation.ts);
 * this is just the per-channel entry point to it, mirroring StartDmModal's form.
 */
export function InviteToChannelModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const mx = useMatrixClient();
  const [userId, setUserId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string>();
  const [invited, setInvited] = useState<string[]>([]);

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const trimmed = userId.trim();
    if (!trimmed || inviting) return;
    if (!isValidUserId(trimmed)) {
      setError('Enter a full Matrix ID, like @friend:example.com or @some-bot:example.com');
      return;
    }
    setInviting(true);
    setError(undefined);
    try {
      await inviteMember(mx, room.roomId, trimmed);
      setInvited((prev) => [trimmed, ...prev]);
      setUserId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setInviting(false);
    }
  };

  return (
    <Modal title={`Invite to #${room.name}`} onClose={onClose}>
      <form className="nu-modal-form" onSubmit={handleSubmit}>
        <label className="nu-field">
          Matrix ID
          <input
            className="nu-field__input"
            data-nu-role="invite-channel-user-id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="@friend:example.com"
            autoFocus
            required
          />
          <span className="nu-field__hint">
            This invites into this one channel only — it doesn't affect their access to the rest
            of the Space, and Space membership doesn't reach this channel either. This is also
            how to get a service bot (e.g. the voice token-server's bot account) into a specific
            voice channel — see docs/voice-architecture.md.
          </span>
        </label>
        {error && (
          <p className="nu-field__error" data-nu-role="invite-channel-error">
            {error}
          </p>
        )}
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="nu-button nu-button--primary" disabled={!userId.trim() || inviting}>
            {inviting ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </form>
      {invited.length > 0 && (
        <ul className="nu-invite-channel__sent" data-nu-role="invite-channel-sent-list">
          {invited.map((id) => (
            <li key={id}>Invited {id}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
