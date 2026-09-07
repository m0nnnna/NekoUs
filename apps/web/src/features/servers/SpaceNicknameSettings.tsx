import { useEffect, useState, type FormEvent } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { useSpaceRooms } from '../../matrix/hooks/useSpaceRooms';
import { clearSpaceNickname, getSpaceNickname, reconcileSpaceNickname, setSpaceNickname } from '../../matrix/nicknames';

/**
 * Unlike every other Space Settings tab, this one isn't an admin action — it's a personal
 * preference ("how does my own name show up in this server"), so any member can use it
 * regardless of their power level. See SpaceSettingsModal.tsx for how that changes which tabs
 * even exist for a non-admin.
 */
export function SpaceNicknameSettings({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const childRooms = useSpaceRooms(space.roomId);
  const [nickname, setNickname] = useState(() => getSpaceNickname(mx, space.roomId) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // Silently catches up any channel created/joined after the nickname was last set — see
  // reconcileSpaceNickname's own comment for why this can't just happen live.
  useEffect(() => {
    if (childRooms.length > 0) {
      reconcileSpaceNickname(mx, space, childRooms).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mx, space, childRooms.length]);

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const trimmed = nickname.trim();
      if (trimmed) await setSpaceNickname(mx, space, childRooms, trimmed);
      else await clearSpaceNickname(mx, space, childRooms);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update nickname');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="nu-modal-form" onSubmit={handleSubmit}>
      <p className="nu-space-nickname__note">
        Changes how your name shows up in every channel of {space.name} — just for you, not
        anyone else's view of you elsewhere.
      </p>
      <label className="nu-field">
        Nickname in {space.name}
        <input
          className="nu-field__input"
          data-nu-role="space-nickname-input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Leave blank to use your regular display name"
          maxLength={256}
        />
      </label>
      {error && <p className="nu-field__error">{error}</p>}
      <div className="nu-form-actions">
        <button type="submit" className="nu-button nu-button--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
