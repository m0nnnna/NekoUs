import { useEffect, useState } from 'react';
import { ClientEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { isUserIgnored } from '../ignoredUsers';

export function useIsUserIgnored(userId: string): boolean {
  const mx = useMatrixClient();
  const [ignored, setIgnored] = useState(() => isUserIgnored(mx, userId));

  useEffect(() => {
    const update = () => setIgnored(isUserIgnored(mx, userId));
    update();
    mx.on(ClientEvent.AccountData, update);
    return () => {
      mx.removeListener(ClientEvent.AccountData, update);
    };
  }, [mx, userId]);

  return ignored;
}
