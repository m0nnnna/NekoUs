import { useEffect, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { selectedRoomIdAtom, selectedSpaceIdAtom, selectedSpaceViewAtom } from '../../app/state/selection';
import { mobileMemberListOpenAtom } from '../../app/state/mobile';
import { useChannelType } from '../../matrix/hooks/useChannelType';
import { usePinnedEventIds } from '../../matrix/hooks/usePinnedEventIds';
import { useRoom } from '../../matrix/hooks/useRoom';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { canInviteToRoom } from '../../matrix/permissions';
import type { ReplyTarget } from '../../matrix/replies';
import { FeedView } from '../feed/FeedView';
import { MessageSearchModal } from '../search/MessageSearchModal';
import { VoiceChannelPanel } from '../voice/VoiceChannelPanel';
import { Composer } from './Composer';
import { InviteToChannelModal } from './InviteToChannelModal';
import { MessageTimeline } from './MessageTimeline';
import { PinnedMessagesPanel } from './PinnedMessagesPanel';
import { ThreadsOverviewModal } from './ThreadsOverviewModal';
import { TopicBanner } from './TopicBanner';
import { TypingIndicator } from './TypingIndicator';
import './MainPane.css';

/** Main content area — a text channel's timeline, a voice channel's call panel, or the Space's
 *  Posts feed (which isn't a channel at all, see matrix/feed.ts). */
export function MainPane() {
  const mx = useMatrixClient();
  const [selectedRoomId, setSelectedRoomId] = useAtom(selectedRoomIdAtom);
  const selectedSpaceId = useAtomValue(selectedSpaceIdAtom);
  const spaceView = useAtomValue(selectedSpaceViewAtom);
  const room = useRoom(selectedRoomId);
  const channelType = useChannelType(room);
  const pinnedIds = usePinnedEventIds(selectedRoomId);
  const [showPinned, setShowPinned] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const setMobileMembersOpen = useSetAtom(mobileMemberListOpenAtom);

  // A staged reply is tied to one room's composer — carrying it over to whatever's selected
  // next would silently attach it to an unrelated message.
  useEffect(() => {
    setReplyingTo(null);
    setMobileMembersOpen(false);
  }, [selectedRoomId, setMobileMembersOpen]);

  // The feed is a merge across many rooms rather than one selected room, so it takes
  // precedence over whatever channel happens to still be selected behind it.
  const feedSpace = spaceView === 'feed' && selectedSpaceId ? mx.getRoom(selectedSpaceId) : null;
  if (feedSpace) {
    return <FeedView space={feedSpace} />;
  }

  if (!room) {
    return (
      <main className="nu-main-pane" data-nu-role="main-pane">
        <div className="nu-main-pane__empty" data-nu-role="main-pane-empty">
          Select a channel to start chatting
        </div>
      </main>
    );
  }

  if (channelType === 'voice') {
    return (
      <main className="nu-main-pane" data-nu-role="main-pane">
        <div className="nu-main-pane__header" data-nu-role="main-pane-header">
          <button
            type="button"
            className="nu-main-pane__header-back"
            data-nu-role="main-pane-back"
            title="Back to channels"
            onClick={() => setSelectedRoomId(null)}
          >
            ←
          </button>
          <span className="nu-main-pane__header-icon" aria-hidden="true">
            🔊
          </span>
          <span className="nu-main-pane__header-name">{room.name}</span>
          {canInviteToRoom(room, mx.getUserId() ?? '') && (
            <div className="nu-main-pane__header-actions">
              <button
                type="button"
                className="nu-main-pane__header-action"
                data-nu-role="main-pane-invite"
                title="Invite to Channel"
                onClick={() => setShowInvite(true)}
              >
                ➕
              </button>
            </div>
          )}
        </div>
        <VoiceChannelPanel room={room} />
        {showInvite && <InviteToChannelModal room={room} onClose={() => setShowInvite(false)} />}
      </main>
    );
  }

  return (
    <main className="nu-main-pane" data-nu-role="main-pane">
      <div className="nu-main-pane__header" data-nu-role="main-pane-header">
        <button
          type="button"
          className="nu-main-pane__header-back"
          data-nu-role="main-pane-back"
          title="Back to channels"
          onClick={() => setSelectedRoomId(null)}
        >
          ←
        </button>
        <span className="nu-main-pane__header-icon" aria-hidden="true">
          #
        </span>
        <span className="nu-main-pane__header-name">{room.name}</span>
        <div className="nu-main-pane__header-actions">
          <button
            type="button"
            className="nu-main-pane__header-action"
            data-nu-role="main-pane-pins"
            title="Pinned Messages"
            onClick={() => setShowPinned(true)}
          >
            📌{pinnedIds.length > 0 ? ` ${pinnedIds.length}` : ''}
          </button>
          <button
            type="button"
            className="nu-main-pane__header-action"
            data-nu-role="main-pane-search"
            title="Search Messages"
            onClick={() => setShowSearch(true)}
          >
            🔍
          </button>
          <button
            type="button"
            className="nu-main-pane__header-action"
            data-nu-role="main-pane-threads"
            title="Threads"
            onClick={() => setShowThreads(true)}
          >
            🧵
          </button>
          {canInviteToRoom(room, mx.getUserId() ?? '') && (
            <button
              type="button"
              className="nu-main-pane__header-action"
              data-nu-role="main-pane-invite"
              title="Invite to Channel"
              onClick={() => setShowInvite(true)}
            >
              ➕
            </button>
          )}
          <button
            type="button"
            className="nu-main-pane__header-action nu-main-pane__header-members-toggle"
            data-nu-role="main-pane-members-toggle"
            title="Members"
            onClick={() => setMobileMembersOpen((open) => !open)}
          >
            👥
          </button>
        </div>
      </div>
      <TopicBanner room={room} />
      <MessageTimeline roomId={room.roomId} onReply={setReplyingTo} />
      <TypingIndicator roomId={room.roomId} />
      <Composer roomId={room.roomId} replyingTo={replyingTo} onCancelReply={() => setReplyingTo(null)} />
      {showPinned && <PinnedMessagesPanel room={room} onClose={() => setShowPinned(false)} />}
      {showSearch && <MessageSearchModal roomId={room.roomId} onClose={() => setShowSearch(false)} />}
      {showThreads && <ThreadsOverviewModal room={room} onClose={() => setShowThreads(false)} />}
      {showInvite && <InviteToChannelModal room={room} onClose={() => setShowInvite(false)} />}
    </main>
  );
}
