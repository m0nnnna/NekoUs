import { useEffect, useState } from 'react';
import { UserEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

export type PresenceInfo = { presence: string | undefined; statusMsg: string | undefined };

function readPresenceInfo(mx: ReturnType<typeof useMatrixClient>, userId: string): PresenceInfo {
  const user = mx.getUser(userId);
  return { presence: user?.presence, statusMsg: user?.presenceStatusMsg };
}

/** Single-user presence + custom status message, live-updated — the same data
 *  MemberList.tsx's `usePresenceMap` computes in bulk for a whole room (kept separate there
 *  deliberately, so the list can group by presence before rendering), generalized for the one-
 *  user case like UserProfileModal's. */
export function usePresenceInfo(userId: string): PresenceInfo {
  const mx = useMatrixClient();
  const [info, setInfo] = useState(() => readPresenceInfo(mx, userId));

  useEffect(() => {
    const update = () => setInfo(readPresenceInfo(mx, userId));
    update();

    const onPresence = (_event: unknown, user: { userId: string }) => {
      if (user.userId === userId) update();
    };
    mx.on(UserEvent.Presence, onPresence);
    return () => {
      mx.removeListener(UserEvent.Presence, onPresence);
    };
  }, [mx, userId]);

  return info;
}
