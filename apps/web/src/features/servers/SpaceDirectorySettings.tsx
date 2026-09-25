import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { invalidatePublicSpaceIds } from '../../matrix/hooks/usePublicSpaceIds';
import { isListedInDirectory, setListedInDirectory } from '../../matrix/spaceDirectory';

/**
 * Lists this Space in the public directory, or takes it off. Shows the server's actual answer,
 * not a guess from the join rule — a Space with a public join link is joinable, not listed, and
 * only a listed one reaches Discover and the global feed.
 */
export function SpaceDirectorySettings({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const [listed, setListed] = useState<boolean>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    isListedInDirectory(mx, space.roomId)
      .then((value) => !cancelled && setListed(value))
      .catch(() => !cancelled && setError('Couldn’t check whether this Space is listed.'));
    return () => {
      cancelled = true;
    };
  }, [mx, space.roomId]);

  const handleToggle = async () => {
    if (submitting || listed === undefined) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await setListedInDirectory(mx, space, !listed);
      setListed(!listed);
      invalidatePublicSpaceIds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t change the listing');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="nu-modal-form" data-nu-role="space-directory-settings">
      <label className="nu-field__checkbox-row">
        <input
          type="checkbox"
          data-nu-role="space-directory-toggle"
          checked={!!listed}
          onChange={handleToggle}
          disabled={submitting || listed === undefined}
        />
        Public space — listed in Discover
      </label>
      <p className="nu-space-invite-link__note" data-nu-role="space-directory-status">
        {listed === undefined
          ? 'Checking…'
          : listed
            ? 'Anyone can find and join this Space, and its posts appear on the global feed and can be reposted there.'
            : 'Not listed. Its posts stay with its members, and can only be reposted within this Space.'}{' '}
        Listing also makes the Space readable without joining and open to join. Each member’s posts
        feed follows the next time they post.
      </p>
      {error && (
        <p className="nu-field__error" data-nu-role="space-directory-error">
          {error}
        </p>
      )}
    </div>
  );
}
