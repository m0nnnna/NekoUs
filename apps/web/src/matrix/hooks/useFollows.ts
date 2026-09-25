import { useEffect, useState } from 'react';
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { FOLLOWS_ACCOUNT_DATA, readFollows, type Follows } from '../follows';

/** Live follow list — updates the moment a follow is toggled anywhere, including another device. */
export function useFollows(): Follows {
  const mx = useMatrixClient();
  const [follows, setFollows] = useState(() => readFollows(mx));

  useEffect(() => {
    setFollows(readFollows(mx));
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === FOLLOWS_ACCOUNT_DATA) setFollows(readFollows(mx));
    };
    mx.on(ClientEvent.AccountData, onAccountData);
    return () => {
      mx.removeListener(ClientEvent.AccountData, onAccountData);
    };
  }, [mx]);

  return follows;
}
