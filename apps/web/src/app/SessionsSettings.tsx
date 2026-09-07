import { useEffect, useRef, useState } from 'react';
import { useMatrixClient } from '../matrix/MatrixClientContext';
import { listSessions, renameSession, signOutSession, type Session } from '../matrix/sessions';
import './SessionsSettings.css';

function formatLastSeen(session: Session): string {
  const when = session.lastSeenTs ? new Date(session.lastSeenTs).toLocaleString() : 'Unknown time';
  const where = session.lastSeenIp ? ` · ${session.lastSeenIp}` : '';
  return `${when}${where}`;
}

/**
 * Every device logged into this account — rename any of them (✏️, matrix/sessions.ts's
 * renameSession) and "Sign out" per device other than the one you're using right now (that's
 * what the main Log Out button in UserPanel already does — this is for ending a session on a
 * *different* device). Most homeservers require re-confirming your password to sign another
 * device out (User-Interactive Auth) — see matrix/sessions.ts for exactly what's handled and
 * what isn't.
 */
export function SessionsSettings() {
  const mx = useMatrixClient();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string>();
  const [signingOut, setSigningOut] = useState<string>();
  const [awaitingPasswordFor, setAwaitingPasswordFor] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const passwordResolveRef = useRef<((password: string | null) => void) | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [renaming, setRenaming] = useState(false);

  const load = () => {
    listSessions(mx)
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sessions'));
  };

  useEffect(load, [mx]);

  const promptForPassword = (deviceId: string): Promise<string | null> => {
    setPasswordInput('');
    setAwaitingPasswordFor(deviceId);
    return new Promise((resolve) => {
      passwordResolveRef.current = resolve;
    });
  };

  const handleSignOut = async (deviceId: string) => {
    if (signingOut) return;
    setSigningOut(deviceId);
    setError(undefined);
    try {
      await signOutSession(mx, deviceId, () => promptForPassword(deviceId));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out that session');
    } finally {
      setSigningOut(undefined);
      setAwaitingPasswordFor(null);
    }
  };

  const submitPassword = () => {
    passwordResolveRef.current?.(passwordInput);
    passwordResolveRef.current = null;
  };

  const cancelPassword = () => {
    passwordResolveRef.current?.(null);
    passwordResolveRef.current = null;
    setAwaitingPasswordFor(null);
    setSigningOut(undefined);
  };

  const startRenaming = (session: Session) => {
    setRenamingId(session.deviceId);
    setRenameInput(session.displayName ?? '');
  };

  const submitRename = async (deviceId: string) => {
    const name = renameInput.trim();
    if (!name || renaming) return;
    setRenaming(true);
    setError(undefined);
    try {
      await renameSession(mx, deviceId, name);
      setRenamingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename that session');
    } finally {
      setRenaming(false);
    }
  };

  if (error && !sessions) {
    return (
      <p className="nu-field__error" data-nu-role="sessions-error">
        {error}
      </p>
    );
  }

  if (!sessions) {
    return <p className="nu-field__hint">Loading…</p>;
  }

  return (
    <div className="nu-sessions" data-nu-role="sessions-list">
      {error && (
        <p className="nu-field__error" data-nu-role="sessions-error">
          {error}
        </p>
      )}
      {sessions.map((session) => (
        <div className="nu-sessions__item" data-nu-role="sessions-item" key={session.deviceId}>
          <div className="nu-sessions__item-info">
            {renamingId === session.deviceId ? (
              <div className="nu-sessions__rename" data-nu-role="sessions-rename-prompt">
                <input
                  className="nu-field__input"
                  data-nu-role="sessions-rename-input"
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitRename(session.deviceId);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
                <button type="button" className="nu-button nu-button--secondary" onClick={() => setRenamingId(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="nu-button nu-button--primary"
                  disabled={!renameInput.trim() || renaming}
                  onClick={() => void submitRename(session.deviceId)}
                >
                  Save
                </button>
              </div>
            ) : (
              <span className="nu-sessions__item-name">
                {session.displayName || session.deviceId}
                {session.isCurrent && <span className="nu-sessions__item-badge">This device</span>}
                <button
                  type="button"
                  className="nu-sessions__rename-trigger"
                  data-nu-role="sessions-rename-trigger"
                  title="Rename"
                  onClick={() => startRenaming(session)}
                >
                  ✏️
                </button>
              </span>
            )}
            <span className="nu-sessions__item-meta">{formatLastSeen(session)}</span>
          </div>
          {!session.isCurrent &&
            (awaitingPasswordFor === session.deviceId ? (
              <div className="nu-sessions__password-prompt" data-nu-role="sessions-password-prompt">
                <input
                  type="password"
                  className="nu-field__input"
                  data-nu-role="sessions-password-input"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Confirm your password"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitPassword();
                    if (e.key === 'Escape') cancelPassword();
                  }}
                />
                <button type="button" className="nu-button nu-button--secondary" onClick={cancelPassword}>
                  Cancel
                </button>
                <button type="button" className="nu-button nu-button--primary" onClick={submitPassword} disabled={!passwordInput}>
                  Confirm
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="nu-button nu-button--secondary"
                data-nu-role="sessions-sign-out"
                disabled={signingOut === session.deviceId}
                onClick={() => void handleSignOut(session.deviceId)}
              >
                {signingOut === session.deviceId ? 'Signing out…' : 'Sign out'}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
