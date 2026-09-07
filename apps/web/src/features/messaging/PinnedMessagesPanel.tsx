import type { Room } from 'matrix-js-sdk';
import { Avatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { usePinnedMessages } from '../../matrix/hooks/usePinnedMessages';
import { canSendStateEvent } from '../../matrix/permissions';
import { unpinMessage } from '../../matrix/pins';
import './PinnedMessagesPanel.css';

export function PinnedMessagesPanel({ room, onClose }: { room: Room; onClose: () => void }) {
  const mx = useMatrixClient();
  const pinned = usePinnedMessages(room.roomId);
  const canUnpin = canSendStateEvent(room, mx.getUserId() ?? '', 'm.room.pinned_events');

  return (
    <Modal title="Pinned Messages" onClose={onClose}>
      {pinned.length === 0 ? (
        <p className="nu-pinned-messages__empty" data-nu-role="pinned-messages-empty">
          No pinned messages yet.
        </p>
      ) : (
        <div className="nu-pinned-messages__list" data-nu-role="pinned-messages-list">
          {pinned.map((event) => {
            const sender = event.sender;
            const senderName = sender?.name ?? event.getSender() ?? '?';
            return (
              <div className="nu-pinned-messages__item" data-nu-role="pinned-messages-item" key={event.getId()}>
                <Avatar name={senderName} mxcUrl={sender?.getMxcAvatarUrl()} size={24} />
                <div className="nu-pinned-messages__item-body">
                  <span className="nu-pinned-messages__item-sender">{senderName}</span>
                  <span className="nu-pinned-messages__item-text">
                    {String(event.getContent().body ?? '')}
                  </span>
                </div>
                {canUnpin && (
                  <button
                    type="button"
                    className="nu-pinned-messages__unpin"
                    data-nu-role="pinned-messages-unpin"
                    onClick={() => unpinMessage(mx, room, event.getId() ?? '')}
                  >
                    Unpin
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
