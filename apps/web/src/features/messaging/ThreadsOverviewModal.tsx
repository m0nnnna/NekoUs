import { useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Avatar } from '../../components/Avatar';
import { Modal } from '../../components/Modal';
import { useRoomEmotes } from '../../matrix/hooks/useRoomEmotes';
import { useThreads } from '../../matrix/hooks/useThreads';
import { ThreadPanel } from './ThreadPanel';
import './ThreadsOverviewModal.css';

/**
 * Every active thread in this channel, one line each (root message preview, reply count, who
 * replied last and when) — previously a thread was only reachable one at a time, via a specific
 * message's own 🧵 action; there was no channel-wide browser. Self-contained (owns its own
 * "which thread is open" state) rather than threading that through MainPane/MessageTimeline,
 * matching how Pinned Messages and Search are already both independent header-triggered modals.
 */
export function ThreadsOverviewModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const threads = useThreads(room.roomId);
  const emotes = useRoomEmotes(room);
  const [openRootEventId, setOpenRootEventId] = useState<string | null>(null);

  const sorted = [...threads.values()].sort((a, b) => (b.lastReplyTs ?? 0) - (a.lastReplyTs ?? 0));
  const openRootEvent = openRootEventId ? room.findEventById(openRootEventId) : undefined;

  return (
    <>
      <Modal title="Threads" onClose={onClose}>
        {sorted.length === 0 ? (
          <p className="nu-threads-overview__empty" data-nu-role="threads-overview-empty">
            No active threads in this channel yet.
          </p>
        ) : (
          <div className="nu-threads-overview__list" data-nu-role="threads-overview-list">
            {sorted.map((thread) => {
              const rootEvent = room.findEventById(thread.rootEventId);
              const rootSenderName = rootEvent?.sender?.name ?? rootEvent?.getSender() ?? '?';
              const rootBody = rootEvent ? String(rootEvent.getContent().body ?? '') : 'Message no longer available';
              return (
                <button
                  key={thread.rootEventId}
                  type="button"
                  className="nu-threads-overview__item"
                  data-nu-role="threads-overview-item"
                  disabled={!rootEvent}
                  onClick={() => setOpenRootEventId(thread.rootEventId)}
                >
                  <Avatar name={rootSenderName} mxcUrl={rootEvent?.sender?.getMxcAvatarUrl()} size={24} />
                  <div className="nu-threads-overview__item-body">
                    <span className="nu-threads-overview__item-sender">{rootSenderName}</span>
                    <span className="nu-threads-overview__item-preview">{rootBody}</span>
                    <span className="nu-threads-overview__item-meta">
                      {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
                      {thread.lastReplySenderName && ` · last from ${thread.lastReplySenderName}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Modal>
      {openRootEvent && <ThreadPanel room={room} rootEvent={openRootEvent} emotes={emotes} onClose={() => setOpenRootEventId(null)} />}
    </>
  );
}
