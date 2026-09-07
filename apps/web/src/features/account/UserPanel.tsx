import { useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { AccountSettingsModal } from '../../app/AccountSettingsModal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { logoutClient } from '../../matrix/client';
import { useOwnPresence } from '../../matrix/hooks/useOwnPresence';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { SavedMessagesModal } from '../messaging/SavedMessagesModal';
import './UserPanel.css';

/** Discord-style bottom-of-sidebar bar: who you're signed in as, account settings, and the one
 *  place in the whole app to sign out (previously nowhere — logoutClient() existed in
 *  matrix/client.ts but nothing called it). */
export function UserPanel() {
  const mx = useMatrixClient();
  const profile = useOwnProfile();
  const { presence, statusMsg } = useOwnPresence();
  const [showSettings, setShowSettings] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    void logoutClient(mx);
  };

  return (
    <div className="nu-user-panel" data-nu-role="user-panel">
      <button
        type="button"
        className="nu-user-panel__identity"
        data-nu-role="user-panel-settings"
        title="Account Settings"
        onClick={() => setShowSettings(true)}
      >
        <Avatar name={profile.displayName} mxcUrl={profile.avatarUrl} size={28} presence={presence ?? 'online'} />
        <span className="nu-user-panel__text">
          <span className="nu-user-panel__name">{profile.displayName}</span>
          {statusMsg && <span className="nu-user-panel__status">{statusMsg}</span>}
        </span>
      </button>
      <button
        type="button"
        className="nu-user-panel__saved"
        data-nu-role="user-panel-saved"
        title="Saved Messages"
        onClick={() => setShowSaved(true)}
      >
        🔖
      </button>
      <button
        type="button"
        className="nu-user-panel__logout"
        data-nu-role="user-panel-logout"
        title="Log Out"
        disabled={loggingOut}
        onClick={handleLogout}
      >
        ⏻
      </button>
      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
      {showSaved && <SavedMessagesModal onClose={() => setShowSaved(false)} />}
    </div>
  );
}
