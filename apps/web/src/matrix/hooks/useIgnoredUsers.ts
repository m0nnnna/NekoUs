import { useEffect, useState } from 'react';
import { ClientEvent, EventType, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

/**
 * Everyone you've ignored (blocked), live. The server filters ignored users out of `/sync`, but
 * posts and comments are read over `/messages` and `/relations` too, which aren't guaranteed to
 * be filtered — so the feed filters them itself.
 */
export function useIgnoredUsers(): ReadonlySet<string> {
  const mx = useMatrixClient();
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(mx.getIgnoredUsers()));

  useEffect(() => {
    const update = () => setIgnored(new Set(mx.getIgnoredUsers()));
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === EventType.IgnoredUserList) update();
    };
    update();
    mx.on(ClientEvent.AccountData, onAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, onAccountData);
    };
  }, [mx]);

  return ignored;
}
