import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { AccountSettingsModal } from '../../app/AccountSettingsModal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { updateOwnPresence, type UserPresence } from '../../matrix/account';
import { logoutClient } from '../../matrix/client';
import { handleFor } from '../../matrix/roles';
import { useOwnPresence } from '../../matrix/hooks/useOwnPresence';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { SavedMessagesModal } from '../messaging/SavedMessagesModal';
import './UserPanel.css';

const PRESENCE_OPTIONS: { value: UserPresence; label: string; hint: string }[] = [
  { value: 'online', label: 'Online', hint: 'Show that you’re around' },
  { value: 'unavailable', label: 'Away', hint: 'Around, but not watching' },
  { value: 'offline', label: 'Invisible', hint: 'Appear offline to everyone' },
];

/** Popover for changing presence in one click, instead of digging through Account Settings.
 *  The status *message* stays in Account Settings; this is the fast path for the common case. */
function StatusMenu({ current, onClose, onEditProfile }: { current: string | undefined; onClose: () => void; onEditProfile: () => void }) {
  const mx = useMatrixClient();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const choose = (presence: UserPresence) => {
    updateOwnPresence(mx, presence)
      .then(onClose)
      .catch((err) => setError(err instanceof Error ? err.message : 'Couldn’t change your status'));
  };

  return (
    <div className="nu-user-panel__menu" data-nu-role="user-panel-status-menu" role="menu" ref={ref}>
      {PRESENCE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={current === option.value}
          className="nu-user-panel__menu-item"
          data-nu-role="user-panel-status-option"
          onClick={() => choose(option.value)}
        >
          <span className={`nu-user-panel__menu-dot nu-user-panel__menu-dot--${option.value}`} aria-hidden="true" />
          <span className="nu-user-panel__menu-text">
            <span className="nu-user-panel__menu-label">{option.label}</span>
            <span className="nu-user-panel__menu-hint">{option.hint}</span>
          </span>
        </button>
      ))}
      {error && <p className="nu-user-panel__menu-error">{error}</p>}
      <div className="nu-user-panel__menu-divider" />
      <button type="button" role="menuitem" className="nu-user-panel__menu-item" onClick={onEditProfile}>
        <Icon name="pencil" size={14} />
        <span className="nu-user-panel__menu-label">Edit profile and status message</span>
      </button>
    </div>
  );
}

/** Discord-style bottom-of-sidebar card: who you're signed in as, a one-click status picker,
 *  saved messages, account settings, and the one place in the whole app to sign out. */
export function UserPanel() {
  const mx = useMatrixClient();
  const profile = useOwnProfile();
  const { presence, statusMsg } = useOwnPresence();
  const [showSettings, setShowSettings] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
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
        data-nu-role="user-panel-identity"
        title="Set your status"
        aria-haspopup="menu"
        aria-expanded={showStatusMenu}
        onClick={() => setShowStatusMenu((open) => !open)}
      >
        <Avatar name={profile.displayName} mxcUrl={profile.avatarUrl} size={34} presence={presence ?? 'online'} />
        <span className="nu-user-panel__text">
          <span className="nu-user-panel__name">{profile.displayName}</span>
          <span className="nu-user-panel__status">{statusMsg || handleFor(mx.getUserId() ?? '')}</span>
        </span>
      </button>
      <button
        type="button"
        className="nu-user-panel__button"
        data-nu-role="user-panel-saved"
        title="Saved messages"
        aria-label="Saved messages"
        onClick={() => setShowSaved(true)}
      >
        <Icon name="bookmark" size={17} />
      </button>
      <button
        type="button"
        className="nu-user-panel__button"
        data-nu-role="user-panel-settings"
        title="Account settings"
        aria-label="Account settings"
        onClick={() => setShowSettings(true)}
      >
        <Icon name="settings" size={17} />
      </button>
      <button
        type="button"
        className="nu-user-panel__button nu-user-panel__button--logout"
        data-nu-role="user-panel-logout"
        title="Log out"
        aria-label="Log out"
        disabled={loggingOut}
        onClick={handleLogout}
      >
        <Icon name="logOut" size={17} />
      </button>
      {showStatusMenu && (
        <StatusMenu
          current={presence}
          onClose={() => setShowStatusMenu(false)}
          onEditProfile={() => {
            setShowStatusMenu(false);
            setShowSettings(true);
          }}
        />
      )}
      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
      {showSaved && <SavedMessagesModal onClose={() => setShowSaved(false)} />}
    </div>
  );
}
