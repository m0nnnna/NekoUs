import { useState } from 'react';
import { EventType, type Room } from 'matrix-js-sdk';
import { Modal } from '../../components/Modal';
import { Avatar } from '../../components/Avatar';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useInvites } from '../../matrix/hooks/useInvites';
import { acceptInvite, classifyInvite, declineInvite, type InviteKind } from '../../matrix/invites';
import './InvitesModal.css';

const KIND_LABEL: Record<InviteKind, string> = {
  space: 'Space',
  channel: 'Channel',
  dm: 'Direct Message',
};

function InviteRow({ room, onAccepted }: { room: Room; onAccepted: (room: Room) => void }) {
  const mx = useMatrixClient();
  const [busy, setBusy] = useState<'accepting' | 'declining'>();
  const [error, setError] = useState<string>();
  const kind = classifyInvite(mx, room);
  const inviterId = room.currentState.getStateEvents(EventType.RoomMember, mx.getUserId() ?? '')?.getSender();
  const inviter = inviterId ? mx.getUser(inviterId)?.displayName || inviterId : undefined;

  const handleAccept = async () => {
    setBusy('accepting');
    setError(undefined);
    try {
      await acceptInvite(mx, room.roomId);
      onAccepted(room);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept');
      setBusy(undefined);
    }
  };

  const handleDecline = async () => {
    setBusy('declining');
    setError(undefined);
    try {
      await declineInvite(mx, room.roomId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline');
      setBusy(undefined);
    }
  };

  return (
    <div className="nu-invites__row" data-nu-role="invite-row">
      <Avatar name={room.name} mxcUrl={room.getMxcAvatarUrl()} size={40} />
      <div className="nu-invites__row-info">
        <div className="nu-invites__row-name">
          {room.name}
          <span className="nu-invites__row-badge">{KIND_LABEL[kind]}</span>
        </div>
        <div className="nu-invites__row-meta">{inviter ? `Invited by ${inviter}` : 'Invitation'}</div>
        {error && <div className="nu-field__error">{error}</div>}
      </div>
      <div className="nu-invites__row-actions">
        <button
          type="button"
          className="nu-button nu-button--secondary"
          data-nu-role="invite-decline"
          disabled={!!busy}
          onClick={handleDecline}
        >
          {busy === 'declining' ? 'Declining…' : 'Decline'}
        </button>
        <button
          type="button"
          className="nu-button nu-button--primary"
          data-nu-role="invite-accept"
          disabled={!!busy}
          onClick={handleAccept}
        >
          {busy === 'accepting' ? 'Joining…' : 'Accept'}
        </button>
      </div>
    </div>
  );
}

/**
 * Every pending invite — Space, channel, or DM alike, Matrix draws no protocol distinction
 * between them (see matrix/invites.ts) — with a real Accept/Decline. Previously there was no
 * invite-handling UI anywhere: an invited room got a local `Room` object the moment it arrived
 * over `/sync` and just silently appeared in the normal server rail/channel list/DM list as if
 * already joined, clickable but useless since its timeline can't be read before joining. Those
 * lists now exclude invite-state rooms (see useSpaces/useSpaceRooms/useSpacelessRooms) so this
 * is the one place left to actually act on one.
 */
export function InvitesModal({ onClose, onAccepted }: { onClose: () => void; onAccepted: (room: Room) => void }) {
  const invites = useInvites();

  return (
    <Modal title="Invites" onClose={onClose}>
      {invites.length === 0 ? (
        <p className="nu-invites__empty">No pending invites.</p>
      ) : (
        <div className="nu-invites__list" data-nu-role="invites-list">
          {invites.map((room) => (
            <InviteRow key={room.roomId} room={room} onAccepted={onAccepted} />
          ))}
        </div>
      )}
    </Modal>
  );
}
