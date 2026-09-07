import { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { UserEvent, type RoomMember } from 'matrix-js-sdk';
import { selectedRoomIdAtom } from '../../app/state/selection';
import { mobileMemberListOpenAtom } from '../../app/state/mobile';
import { Avatar } from '../../components/Avatar';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { UserProfileModal } from '../profile/UserProfileModal';
import './MemberList.css';

type PresenceInfo = { presence: string | undefined; statusMsg: string | undefined };

/**
 * A userId -> {presence, statusMsg} map for the given members, recomputed on any presence
 * change. Kept at this level (not one `usePresence` call per row) specifically so the list can
 * group members by presence before rendering rows, rather than each row discovering its own
 * presence independently after the fact.
 */
function useMemberPresenceMap(members: RoomMember[]): Map<string, PresenceInfo> {
  const mx = useMatrixClient();
  const [, forceRender] = useState(0);

  useEffect(() => {
    const onPresence = () => forceRender((n) => n + 1);
    mx.on(UserEvent.Presence, onPresence);
    return () => {
      mx.removeListener(UserEvent.Presence, onPresence);
    };
  }, [mx]);

  const map = new Map<string, PresenceInfo>();
  members.forEach((member) => {
    const user = mx.getUser(member.userId);
    map.set(member.userId, { presence: user?.presence, statusMsg: user?.presenceStatusMsg });
  });
  return map;
}

function MemberRow({
  member,
  presenceInfo,
  onOpenProfile,
}: {
  member: RoomMember;
  presenceInfo: PresenceInfo;
  onOpenProfile: () => void;
}) {
  return (
    <button
      type="button"
      className="nu-member-list__item"
      data-nu-role="member-list-item"
      title={presenceInfo.statusMsg || undefined}
      onClick={onOpenProfile}
    >
      <Avatar name={member.name} mxcUrl={member.getMxcAvatarUrl()} size={24} presence={presenceInfo.presence ?? 'offline'} />
      <span className="nu-member-list__item-text">
        <span className="nu-member-list__item-name">{member.name}</span>
        {presenceInfo.statusMsg && <span className="nu-member-list__item-status">{presenceInfo.statusMsg}</span>}
      </span>
    </button>
  );
}

/**
 * Right panel — joined members of the selected room, grouped Online/Offline. Presence relies
 * on the homeserver actually sending it — some disable it for privacy/performance, in which
 * case everyone will just show as offline; that's a server-side choice, not a bug here.
 */
export function MemberList() {
  const selectedRoomId = useAtomValue(selectedRoomIdAtom);
  const members = useRoomMembers(selectedRoomId);
  const presenceMap = useMemberPresenceMap(members);
  const [profileMember, setProfileMember] = useState<RoomMember | null>(null);
  const [, setMobileMembersOpen] = useAtom(mobileMemberListOpenAtom);

  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const online = sorted.filter((member) => presenceMap.get(member.userId)?.presence === 'online');
  const offline = sorted.filter((member) => presenceMap.get(member.userId)?.presence !== 'online');

  return (
    <aside className="nu-member-list" data-nu-role="member-list">
      <div className="nu-member-list__header" data-nu-role="member-list-header">
        <span className="nu-member-list__header-title">
          Members{selectedRoomId ? ` — ${members.length}` : ''}
        </span>
        <button
          type="button"
          className="nu-member-list__close"
          data-nu-role="member-list-close"
          title="Close"
          onClick={() => setMobileMembersOpen(false)}
        >
          ×
        </button>
      </div>
      <div className="nu-member-list__body" data-nu-role="member-list-body">
        {online.length > 0 && (
          <>
            <div className="nu-member-list__group-label" data-nu-role="member-list-group">
              Online — {online.length}
            </div>
            {online.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                presenceInfo={presenceMap.get(member.userId) ?? { presence: undefined, statusMsg: undefined }}
                onOpenProfile={() => setProfileMember(member)}
              />
            ))}
          </>
        )}
        {offline.length > 0 && (
          <>
            <div className="nu-member-list__group-label" data-nu-role="member-list-group">
              Offline — {offline.length}
            </div>
            {offline.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                presenceInfo={presenceMap.get(member.userId) ?? { presence: undefined, statusMsg: undefined }}
                onOpenProfile={() => setProfileMember(member)}
              />
            ))}
          </>
        )}
      </div>
      {profileMember && (
        <UserProfileModal
          userId={profileMember.userId}
          displayName={profileMember.name}
          avatarMxcUrl={profileMember.getMxcAvatarUrl()}
          onClose={() => setProfileMember(null)}
        />
      )}
    </aside>
  );
}
