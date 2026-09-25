import { useEffect, useState } from 'react';
import { ClientEvent, RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { isPostEvent } from '../feed';
import { hasNewPosts, POSTS_SEEN_ACCOUNT_DATA } from '../postsSeen';

/** Whether someone has posted in this Space since you last looked (matrix/postsSeen.ts), live. */
export function useHasNewPosts(space: Room | null): boolean {
  const mx = useMatrixClient();
  const [fresh, setFresh] = useState(() => (space ? hasNewPosts(mx, space) : false));

  useEffect(() => {
    if (!space) {
      setFresh(false);
      return undefined;
    }
    const update = () => setFresh(hasNewPosts(mx, space));
    const onTimeline = (event: MatrixEvent) => {
      if (isPostEvent(event)) update();
    };
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === POSTS_SEEN_ACCOUNT_DATA) update();
    };
    update();
    mx.on(RoomEvent.Timeline, onTimeline);
    mx.on(RoomEvent.Redaction, update);
    mx.on(ClientEvent.AccountData, onAccountData);
    return () => {
      mx.removeListener(RoomEvent.Timeline, onTimeline);
      mx.removeListener(RoomEvent.Redaction, update);
      mx.removeListener(ClientEvent.AccountData, onAccountData);
    };
  }, [mx, space]);

  return fresh;
}
