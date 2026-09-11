import { useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { ServerRail } from '../features/servers/ServerRail';
import { ChannelList } from '../features/channels/ChannelList';
import { MainPane } from '../features/messaging/MainPane';
import { MemberList } from '../features/members/MemberList';
import { DesktopNotifications } from '../features/notifications/DesktopNotifications';
import { MentionInboxCollector } from '../features/notifications/MentionInboxCollector';
import { IncomingVerificationListener } from '../features/security/IncomingVerificationListener';
import { RecoveryKeyPrompt } from '../features/security/RecoveryKeyPrompt';
import { VoiceCallSession } from '../features/voice/VoiceCallSession';
import { useJoinFromInviteLink } from '../matrix/hooks/useJoinFromInviteLink';
import { useOpenRoomFromNotification } from '../matrix/hooks/useOpenRoomFromNotification';
import { useRecoveryStatus } from '../matrix/hooks/useRecoveryStatus';
import { selectedRoomIdAtom } from './state/selection';
import { mobileMemberListOpenAtom } from './state/mobile';

/** Real Discord-shaped three-pane shell, wired to live Matrix data (Phase 1+). */
export function AppShell() {
  const recoveryStatus = useRecoveryStatus();
  const [recoveryResolved, setRecoveryResolved] = useState(false);
  const selectedRoomId = useAtomValue(selectedRoomIdAtom);
  const [mobileMembersOpen, setMobileMembersOpen] = useAtom(mobileMemberListOpenAtom);
  useOpenRoomFromNotification();
  const inviteLinkJoin = useJoinFromInviteLink();
  const [inviteErrorDismissed, setInviteErrorDismissed] = useState(false);

  return (
    <div
      className="nu-shell"
      data-nu-role="app-shell"
      // Below the responsive breakpoint (styles/base/shell.css) the shell shows one "screen" at
      // a time instead of all four columns side by side — these two attributes are what the
      // media query switches on. They're no-ops above the breakpoint.
      data-nu-mobile-pane={selectedRoomId ? 'chat' : 'sidebar'}
      data-nu-mobile-members-open={mobileMembersOpen}
    >
      <VoiceCallSession>
        <ServerRail />
        <ChannelList />
        <MainPane />
        <MemberList />
      </VoiceCallSession>
      {mobileMembersOpen && (
        <div
          className="nu-shell__mobile-backdrop"
          data-nu-role="mobile-member-list-backdrop"
          onClick={() => setMobileMembersOpen(false)}
        />
      )}
      <DesktopNotifications />
      <MentionInboxCollector />
      <IncomingVerificationListener />
      {recoveryStatus === 'needed' && !recoveryResolved && (
        <RecoveryKeyPrompt onResolved={() => setRecoveryResolved(true)} />
      )}
      {inviteLinkJoin.status === 'error' && !inviteErrorDismissed && (
        <div className="nu-invite-link-banner" data-nu-role="invite-link-error">
          Couldn't join from that invite link: {inviteLinkJoin.message}
          <button
            type="button"
            className="nu-invite-link-banner__dismiss"
            onClick={() => setInviteErrorDismissed(true)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
