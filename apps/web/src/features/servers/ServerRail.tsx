import { useState } from 'react';
import { useAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { selectedRoomIdAtom, selectedSpaceIdAtom } from '../../app/state/selection';
import { UnreadBadge } from '../../components/UnreadBadge';
import { DiscoverModal } from '../discover/DiscoverModal';
import { InvitesModal } from '../invites/InvitesModal';
import { MentionInboxModal } from '../mentions/MentionInboxModal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useMediaUrl } from '../../matrix/hooks/useMediaUrl';
import { useInvites } from '../../matrix/hooks/useInvites';
import { useMentionInbox } from '../../matrix/hooks/useMentionInbox';
import { useSpaceRooms } from '../../matrix/hooks/useSpaceRooms';
import { useSpacelessRooms } from '../../matrix/hooks/useSpacelessRooms';
import { useSpaces } from '../../matrix/hooks/useSpaces';
import { useUnreadSummary } from '../../matrix/hooks/useUnreadCounts';
import { classifyInvite } from '../../matrix/invites';
import { getParentSpace } from '../../matrix/voice';
import { CreateSpaceModal } from './CreateSpaceModal';
import './ServerRail.css';

function ServerRailItem({ space, active, onSelect }: { space: Room; active: boolean; onSelect: () => void }) {
  const src = useMediaUrl(space.getMxcAvatarUrl(), { width: 96, height: 96, method: 'crop' });
  const unread = useUnreadSummary(useSpaceRooms(space.roomId));

  return (
    <button
      type="button"
      className={active ? 'nu-server-rail__item nu-server-rail__item--active' : 'nu-server-rail__item'}
      data-nu-role="server-rail-item"
      title={space.name}
      onClick={onSelect}
    >
      {src ? (
        <img className="nu-server-rail__item-image" src={src} alt="" />
      ) : (
        (space.name || '?').slice(0, 1).toUpperCase()
      )}
      <span className="nu-server-rail__item-badge">
        <UnreadBadge total={unread.total} highlight={unread.highlight} />
      </span>
    </button>
  );
}

/** Left icon rail — one icon per joined Matrix Space, mapped to a Discord "server". */
export function ServerRail() {
  const mx = useMatrixClient();
  const spaces = useSpaces();
  const invites = useInvites();
  const mentions = useMentionInbox();
  const [selectedSpaceId, setSelectedSpaceId] = useAtom(selectedSpaceIdAtom);
  const [, setSelectedRoomId] = useAtom(selectedRoomIdAtom);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [showInvites, setShowInvites] = useState(false);
  const [showMentions, setShowMentions] = useState(false);
  const dmUnread = useUnreadSummary(useSpacelessRooms());

  const selectSpace = (id: string | null) => {
    setSelectedSpaceId(id);
    setSelectedRoomId(null);
  };

  const handleInviteAccepted = (room: Room) => {
    const kind = classifyInvite(mx, room);
    if (kind === 'space') {
      selectSpace(room.roomId);
    } else if (kind === 'channel') {
      const parentId = getParentSpace(mx, room)?.roomId ?? null;
      setSelectedSpaceId(parentId);
      setSelectedRoomId(room.roomId);
    } else {
      setSelectedSpaceId(null);
      setSelectedRoomId(room.roomId);
    }
  };

  return (
    <nav className="nu-server-rail" data-nu-role="server-rail">
      <button
        type="button"
        className={
          selectedSpaceId === null
            ? 'nu-server-rail__item nu-server-rail__item--home nu-server-rail__item--active'
            : 'nu-server-rail__item nu-server-rail__item--home'
        }
        data-nu-role="server-rail-home"
        title="Direct Messages"
        onClick={() => selectSpace(null)}
      >
        N
        <span className="nu-server-rail__item-badge">
          <UnreadBadge total={dmUnread.total} highlight={dmUnread.highlight} />
        </span>
      </button>
      <div className="nu-server-rail__divider" />
      <div className="nu-server-rail__list" data-nu-role="server-rail-list">
        {spaces.map((space) => (
          <ServerRailItem
            key={space.roomId}
            space={space}
            active={selectedSpaceId === space.roomId}
            onSelect={() => selectSpace(space.roomId)}
          />
        ))}
      </div>
      <button
        type="button"
        className="nu-server-rail__item nu-server-rail__item--mentions"
        data-nu-role="server-rail-mentions"
        title="Mentions"
        onClick={() => setShowMentions(true)}
      >
        @
        <span className="nu-server-rail__item-badge">
          <UnreadBadge total={mentions.length} highlight={mentions.length} />
        </span>
      </button>
      <button
        type="button"
        className="nu-server-rail__item nu-server-rail__item--invites"
        data-nu-role="server-rail-invites"
        title="Invites"
        onClick={() => setShowInvites(true)}
      >
        ✉️
        <span className="nu-server-rail__item-badge">
          <UnreadBadge total={invites.length} highlight={invites.length} />
        </span>
      </button>
      <button
        type="button"
        className="nu-server-rail__item nu-server-rail__item--discover"
        data-nu-role="server-rail-discover"
        title="Discover Public Servers & Channels"
        onClick={() => setShowDiscover(true)}
      >
        🧭
      </button>
      <button
        type="button"
        className="nu-server-rail__item nu-server-rail__item--add"
        data-nu-role="server-rail-add"
        title="Create a Space"
        onClick={() => setShowCreateSpace(true)}
      >
        +
      </button>
      {showCreateSpace && (
        <CreateSpaceModal
          onClose={() => setShowCreateSpace(false)}
          onCreated={(roomId) => {
            setShowCreateSpace(false);
            selectSpace(roomId);
          }}
        />
      )}
      {showDiscover && (
        <DiscoverModal
          onClose={() => setShowDiscover(false)}
          onJoinedSpace={(roomId) => selectSpace(roomId)}
          onJoinedRoom={(roomId) => {
            setSelectedSpaceId(null);
            setSelectedRoomId(roomId);
          }}
        />
      )}
      {showInvites && (
        <InvitesModal
          onClose={() => setShowInvites(false)}
          onAccepted={(room) => {
            setShowInvites(false);
            handleInviteAccepted(room);
          }}
        />
      )}
      {showMentions && <MentionInboxModal onClose={() => setShowMentions(false)} />}
    </nav>
  );
}
