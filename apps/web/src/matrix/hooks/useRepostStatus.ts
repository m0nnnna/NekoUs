import { useEffect, useState } from 'react';
import { RoomEvent, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import type { RepostOf } from '../feed';
import { checkRepost, forgetRepostCheck, type RepostStatus } from '../repostCheck';

/**
 * Whether a repost's embedded copy still matches its original (matrix/repostCheck.ts). `pending`
 * until the check answers; `undefined` for a post that isn't a repost. Turns `deleted` as soon as
 * the original is redacted in a room this client is in.
 */
export function useRepostStatus(repostOf: RepostOf | undefined): RepostStatus | 'pending' | undefined {
  const mx = useMatrixClient();
  const [status, setStatus] = useState<RepostStatus | 'pending' | undefined>(repostOf ? 'pending' : undefined);

  useEffect(() => {
    if (!repostOf) {
      setStatus(undefined);
      return undefined;
    }
    let alive = true;
    setStatus('pending');
    void checkRepost(mx, repostOf).then((result) => {
      if (alive) setStatus(result);
    });

    const onRedaction = (redaction: MatrixEvent) => {
      const redacted = redaction.event.redacts ?? (redaction.getContent() as { redacts?: string }).redacts;
      if (redaction.getRoomId() !== repostOf.roomId || redacted !== repostOf.eventId) return;
      forgetRepostCheck(repostOf.roomId, repostOf.eventId);
      setStatus('deleted');
    };
    mx.on(RoomEvent.Redaction, onRedaction);
    return () => {
      alive = false;
      mx.removeListener(RoomEvent.Redaction, onRedaction);
    };
  }, [mx, repostOf]);

  return status;
}
