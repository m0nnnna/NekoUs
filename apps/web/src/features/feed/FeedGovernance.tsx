import { useEffect } from 'react';
import { ClientEvent, EventType, RoomStateEvent, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { listOwnFeedRooms } from '../../matrix/feed';
import { governOwnFeeds } from '../../matrix/feedGovernance';

/** Space state that changes what its feeds should look like. */
const WATCHED_STATE = new Set<string>([
  EventType.RoomMember,
  EventType.RoomPowerLevels,
  EventType.RoomHistoryVisibility,
  EventType.RoomCreate,
]);

/**
 * Keeps the feed rooms you own in line with their Spaces (matrix/feedGovernance.ts): removes people
 * who left or were banned, mirrors the Space's moderators, and follows the Space being listed or
 * not. Once at start for every feed, then for one Space whenever its members, moderators or
 * visibility change. Headless, mounted once in AppShell.
 */
export function FeedGovernance() {
  const mx = useMatrixClient();

  useEffect(() => {
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // What the next pass covers: every feed, some Spaces' feeds, or nothing queued.
    let queued: 'all' | Set<string> | undefined;

    const run = async () => {
      if (running) return; // the finally below picks up whatever was queued meanwhile
      running = true;
      const spaceIds = queued === 'all' ? undefined : queued;
      queued = undefined;
      try {
        await governOwnFeeds(mx, spaceIds);
      } finally {
        running = false;
        if (queued) startTimer();
      }
    };
    const startTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 2000);
    };
    const queue = (spaceId: string | 'all') => {
      if (spaceId === 'all') queued = 'all';
      else if (queued !== 'all') queued = new Set([...(queued ?? []), spaceId]);
      startTimer();
    };

    const onState = (event: MatrixEvent) => {
      if (!WATCHED_STATE.has(event.getType())) return;
      const roomId = event.getRoomId();
      if (roomId && listOwnFeedRooms(mx).some((feed) => feed.spaceId === roomId)) queue(roomId);
    };
    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() === 'xyz.nekous.feed_rooms') queue('all');
    };

    queue('all');
    mx.on(RoomStateEvent.Events, onState);
    mx.on(ClientEvent.AccountData, onAccountData);
    return () => {
      clearTimeout(timer);
      mx.removeListener(RoomStateEvent.Events, onState);
      mx.removeListener(ClientEvent.AccountData, onAccountData);
    };
  }, [mx]);

  return null;
}
