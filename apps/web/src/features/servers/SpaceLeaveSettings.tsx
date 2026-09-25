import { useState } from 'react';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { selectedRoomIdAtom, selectedSpaceIdAtom, selectedSpaceViewAtom } from '../../app/state/selection';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { leaveSpace, wouldOrphanSpace } from '../../matrix/leaveSpace';

/** Leaving the Space, its channels and its Posts (matrix/leaveSpace.ts). Every member sees this. */
export function SpaceLeaveSettings({ space, onClose }: { space: Room; onClose: () => void }) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string>();
  const orphans = wouldOrphanSpace(space, myUserId);

  const handleLeave = async () => {
    setLeaving(true);
    setError(undefined);
    try {
      const { failed } = await leaveSpace(mx, space);
      setSelectedSpaceId(null);
      setSelectedRoomId(null);
      setSpaceView(null);
      if (failed > 0) {
        // Out of the Space already; say so rather than pretending nothing happened.
        setError(`Left ${space.name}, but ${failed} of its channels couldn’t be left. They’re under Home.`);
        setLeaving(false);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t leave this space');
      setLeaving(false);
    }
  };

  return (
    <div className="nu-modal-form" data-nu-role="space-leave">
      <p>
        Leaving {space.name} takes you out of all its channels too, and your posts stop showing on its Posts page.
        You can rejoin later if it’s public or someone invites you, and your posts come back with you.
      </p>
      {orphans && (
        <p className="nu-field__error" data-nu-role="space-leave-last-admin">
          You’re the only admin here. Once you leave, nobody will be able to manage this space. Make someone else an
          admin first under Members.
        </p>
      )}
      {error && <p className="nu-field__error">{error}</p>}
      <div className="nu-form-actions">
        <button
          type="button"
          className="nu-button nu-button--primary"
          data-nu-role="space-leave-confirm"
          disabled={leaving}
          onClick={() => void handleLeave()}
        >
          {leaving ? 'Leaving…' : `Leave ${space.name}`}
        </button>
      </div>
    </div>
  );
}
