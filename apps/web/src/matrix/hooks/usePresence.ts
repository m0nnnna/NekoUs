import { useEffect, useState } from 'react';
import { UserEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

/**
 * A user's presence ("online" | "offline" | "unavailable" | ...), or undefined if unknown.
 * Note some homeservers disable presence entirely (a privacy/performance tradeoff) — on those,
 * this will just never resolve to anything, which callers should treat as "unknown," not "offline."
 */
export function usePresence(userId: string): string | undefined {
  const mx = useMatrixClient();
  const [presence, setPresence] = useState(() => mx.getUser(userId)?.presence);

  useEffect(() => {
    const update = () => setPresence(mx.getUser(userId)?.presence);
    update();

    const onPresence = (_event: unknown, user: { userId: string }) => {
      if (user.userId === userId) update();
    };
    mx.on(UserEvent.Presence, onPresence);
    return () => {
      mx.removeListener(UserEvent.Presence, onPresence);
    };
  }, [mx, userId]);

  return presence;
}
