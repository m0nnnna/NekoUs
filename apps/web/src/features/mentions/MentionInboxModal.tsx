import { useAtom } from 'jotai';
import { pendingJumpTargetAtom, selectedRoomIdAtom, selectedSpaceIdAtom } from '../../app/state/selection';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useMentionInbox } from '../../matrix/hooks/useMentionInbox';
import { clearMentionInbox, removeMentionFromInbox } from '../../matrix/mentionInbox';
import { findParentSpaceId } from '../../matrix/spaceChildren';
import './MentionInboxModal.css';

/**
 * Every live @-mention caught by MentionInboxCollector, across every room — private to you, same
 * "only shows what's actually loaded in memory for that room right now" limitation
 * SavedMessagesModal has. Unlike that modal, opening one here jumps straight to and highlights
 * the exact message (`pendingJumpTargetAtom`, the same mechanism search results use) rather than
 * just landing in the room — the entire point of this feature is not having to hunt for it once
 * you're there. Dismissing is a deliberate, explicit action (the × per row, or "Clear all") —
 * opening one does *not* auto-remove it, so you can jump to a mention, read it, and still have it
 * to find again later if you want.
 */
export function MentionInboxModal({ onClose }: { onClose: () => void }) {
  const mx = useMatrixClient();
  const mentions = useMentionInbox();
  const [, setSelectedSpaceId] = useAtom(selectedSpaceIdAtom);
  const [, setSelectedRoomId] = useAtom(selectedRoomIdAtom);
  const [, setPendingJump] = useAtom(pendingJumpTargetAtom);

  const sorted = [...mentions].sort((a, b) => b.mentionedAt - a.mentionedAt);

  const openMention = (roomId: string, eventId: string) => {
    setSelectedSpaceId(findParentSpaceId(mx, roomId));
    setSelectedRoomId(roomId);
    setPendingJump({ roomId, eventId });
    onClose();
  };

  return (
    <Modal title="Mentions" onClose={onClose}>
      {sorted.length === 0 ? (
        <p className="nu-mention-inbox__empty" data-nu-role="mention-inbox-empty">
          No mentions yet — when someone @-mentions you, it'll show up here.
        </p>
      ) : (
        <>
          <div className="nu-mention-inbox__list" data-nu-role="mention-inbox-list">
            {sorted.map((item) => {
              const room = mx.getRoom(item.roomId);
              const event = room?.findEventById(item.eventId);
              const senderName = event?.sender?.name ?? event?.getSender() ?? '?';
              const body = event ? String(event.getContent().body ?? '') : null;
              return (
                <div className="nu-mention-inbox__item" data-nu-role="mention-inbox-item" key={`${item.roomId}:${item.eventId}`}>
                  <button
                    type="button"
                    className="nu-mention-inbox__item-open"
                    data-nu-role="mention-inbox-open"
                    disabled={!room}
                    onClick={() => openMention(item.roomId, item.eventId)}
                  >
                    <span className="nu-mention-inbox__item-room">{room?.name ?? 'Unknown channel'}</span>
                    {body ? (
                      <span className="nu-mention-inbox__item-preview">
                        <strong>{senderName}:</strong> {body}
                      </span>
                    ) : (
                      <span className="nu-mention-inbox__item-preview nu-mention-inbox__item-preview--missing">
                        Message no longer available
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="nu-mention-inbox__item-remove"
                    data-nu-role="mention-inbox-remove"
                    title="Dismiss"
                    onClick={() => void removeMentionFromInbox(mx, item.roomId, item.eventId)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div className="nu-form-actions">
            <button
              type="button"
              className="nu-button nu-button--secondary"
              data-nu-role="mention-inbox-clear-all"
              onClick={() => void clearMentionInbox(mx)}
            >
              Clear all
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
