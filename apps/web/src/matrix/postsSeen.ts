import type { MatrixClient, Room } from 'matrix-js-sdk';
import { isPostEvent, listSpaceFeeds } from './feed';
import { readFreshAccountData } from './freshAccountData';

/**
 * "New posts" on a Space's Posts row: someone else has posted since you last had the page open.
 *
 * Posts notify nobody (feed.ts) and don't count as unread, so the channel list had no way to say
 * anything was there. When you last looked is kept per Space in account data, so it's the same on
 * every device. A Space you've never opened Posts in counts from when this session started, rather
 * than lighting up every Space at once for posts that were always there.
 */
const POSTS_SEEN_ACCOUNT_DATA = 'xyz.nekous.posts_seen';

const sessionStart = Date.now();

export function readPostsSeen(mx: MatrixClient): Record<string, number> {
  return mx.getAccountData(POSTS_SEEN_ACCOUNT_DATA as any)?.getContent<Record<string, number>>() ?? {};
}

/** The newest post by anyone but you across the Space's feeds this client has joined, or 0. */
export function newestPostByOthers(mx: MatrixClient, space: Room): number {
  const me = mx.getUserId();
  let newest = 0;
  listSpaceFeeds(space).forEach(({ userId, roomId }) => {
    if (userId === me) return;
    const room = mx.getRoom(roomId);
    if (room?.getMyMembership() !== 'join') return;
    const events = room.getLiveTimeline().getEvents();
    // Newest last; the first owner post from the end is the newest one in this feed.
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (isPostEvent(event) && event.getSender() === userId) {
        newest = Math.max(newest, event.getTs());
        break;
      }
    }
  });
  return newest;
}

export function hasNewPosts(mx: MatrixClient, space: Room): boolean {
  const seen = readPostsSeen(mx)[space.roomId];
  return newestPostByOthers(mx, space) > (typeof seen === 'number' ? seen : sessionStart);
}

/** Records that you've seen the Space's posts up to now. Skips the write when nothing's changed. */
export async function markPostsSeen(mx: MatrixClient, space: Room): Promise<void> {
  const newest = newestPostByOthers(mx, space);
  const seen = readPostsSeen(mx)[space.roomId];
  if (typeof seen === 'number' && seen >= newest) return;
  const current = (await readFreshAccountData<Record<string, number>>(mx, POSTS_SEEN_ACCOUNT_DATA)) ?? {};
  await mx.setAccountData(POSTS_SEEN_ACCOUNT_DATA as any, { ...current, [space.roomId]: Math.max(Date.now(), newest) } as any);
}

export { POSTS_SEEN_ACCOUNT_DATA };
