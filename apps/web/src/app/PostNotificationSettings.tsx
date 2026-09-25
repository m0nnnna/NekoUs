import { useState } from 'react';
import { useMatrixClient } from '../matrix/MatrixClientContext';
import {
  readPostNotificationSettings,
  setPostNotificationSettings,
  type PostNotificationSettings as Settings,
} from '../matrix/postNotifications';

/**
 * Whether likes and comments on your posts notify you — in the app and through background push
 * alike, since both follow the push rules this changes (matrix/postNotifications.ts). Applies the
 * moment it's toggled, like background push above it, rather than waiting for the form's Save.
 */
export function PostNotificationSettings() {
  const mx = useMatrixClient();
  const [settings, setSettings] = useState<Settings>(() => readPostNotificationSettings(mx));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const update = async (next: Settings) => {
    if (busy) return;
    const previous = settings;
    setSettings(next);
    setBusy(true);
    setError(undefined);
    try {
      await setPostNotificationSettings(mx, next);
    } catch (err) {
      setSettings(previous);
      setError(err instanceof Error ? err.message : 'Couldn’t change post notifications');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nu-field" data-nu-role="post-notification-settings">
      Posts
      <label className="nu-field__checkbox-row">
        <input
          type="checkbox"
          data-nu-role="post-notify-comments"
          checked={settings.comments}
          disabled={busy}
          onChange={(e) => void update({ ...settings, comments: e.target.checked })}
        />
        Notify me when someone comments on my posts
      </label>
      <label className="nu-field__checkbox-row">
        <input
          type="checkbox"
          data-nu-role="post-notify-likes"
          checked={settings.likes}
          disabled={busy}
          onChange={(e) => void update({ ...settings, likes: e.target.checked })}
        />
        Notify me when someone likes my posts (quietly)
      </label>
      {error && <p className="nu-field__error">{error}</p>}
    </div>
  );
}
