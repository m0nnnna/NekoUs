import { useEffect, useState } from 'react';
import { UserEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

type OwnPresence = {
  presence: string | undefined;
  statusMsg: string | undefined;
};

function readPresence(mx: ReturnType<typeof useMatrixClient>): OwnPresence {
  const user = mx.getUser(mx.getUserId() ?? '');
  return { presence: user?.presence, statusMsg: user?.presenceStatusMsg };
}

/**
 * The signed-in user's own presence + custom status message, live-updated the moment
 * updateOwnPresence (account.ts) applies its optimistic local patch.
 *
 * Deliberately listens on the `User` object directly rather than `mx.on(UserEvent.Presence, …)`
 * the way usePresence.ts does for other members: the client only re-emits a User's events onto
 * itself for User objects created via the SDK's normal `User.createUser()` path (every other
 * member you encounter through room state goes through it), but the client's *own* User object
 * can already exist — created the plain way, with no client re-emitter wired up — from crypto/
 * account bootstrapping before any real sync data arrives. Listening on the object itself works
 * either way.
 */
export function useOwnPresence(): OwnPresence {
  const mx = useMatrixClient();
  const [state, setState] = useState(() => readPresence(mx));

  useEffect(() => {
    const userId = mx.getUserId();
    if (!userId) return;
    const update = () => setState(readPresence(mx));
    update();

    const user = mx.getUser(userId);
    user?.on(UserEvent.Presence, update);
    return () => {
      user?.removeListener(UserEvent.Presence, update);
    };
  }, [mx]);

  return state;
}
