import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { POST_EVENT_TYPE } from './feed';
import { hasNewPosts, markPostsSeen, newestPostByOthers } from './postsSeen';

const ME = '@me:x';
const SPACE = '!space:x';

function setup({ seen, posts }: { seen?: number; posts: { feed: string; owner: string; ts: number }[] }) {
  const feeds = [...new Set(posts.map((p) => `${p.owner}|${p.feed}`))].map((key) => key.split('|'));
  const space = {
    roomId: SPACE,
    currentState: {
      getStateEvents: () =>
        feeds.map(([owner, feed]) => ({
          getContent: () => ({ membership: 'join', 'xyz.nekous.feed_room': feed }),
          getStateKey: () => owner,
        })),
    },
  } as unknown as Room;
  const rooms = new Map(
    feeds.map(([, feed]) => [
      feed,
      {
        getMyMembership: () => 'join',
        getLiveTimeline: () => ({
          getEvents: () =>
            posts
              .filter((p) => p.feed === feed)
              .map((p, i) => new MatrixEvent({ event_id: `$${feed}${i}`, type: POST_EVENT_TYPE, sender: p.owner, origin_server_ts: p.ts, content: { body: 'x' } })),
        }),
      },
    ])
  );
  let accountData: Record<string, number> | undefined = seen === undefined ? undefined : { [SPACE]: seen };
  const setAccountData = vi.fn(async (_type: string, content: Record<string, number>) => {
    accountData = content;
  });
  const mx = {
    getUserId: () => ME,
    getRoom: (id: string) => rooms.get(id) ?? null,
    getAccountData: () => (accountData ? { getContent: () => accountData } : undefined),
    setAccountData,
  } as unknown as MatrixClient;
  return { mx, space, setAccountData };
}

describe('new posts', () => {
  it('counts only other people’s posts', () => {
    const { mx, space } = setup({ posts: [{ feed: '!mine', owner: ME, ts: 900 }, { feed: '!bob', owner: '@bob:x', ts: 500 }] });
    expect(newestPostByOthers(mx, space)).toBe(500);
  });

  it('is new when someone posted after you last looked, and not after', () => {
    const earlier = setup({ seen: 100, posts: [{ feed: '!bob', owner: '@bob:x', ts: 200 }] });
    expect(hasNewPosts(earlier.mx, earlier.space)).toBe(true);
    const later = setup({ seen: 300, posts: [{ feed: '!bob', owner: '@bob:x', ts: 200 }] });
    expect(hasNewPosts(later.mx, later.space)).toBe(false);
  });

  it('doesn’t light up a never-opened Space for posts from before this session', () => {
    const { mx, space } = setup({ posts: [{ feed: '!bob', owner: '@bob:x', ts: 1 }] });
    expect(hasNewPosts(mx, space)).toBe(false);
  });

  it('marking seen clears it, and skips the write when nothing is new', async () => {
    const { mx, space, setAccountData } = setup({ seen: 100, posts: [{ feed: '!bob', owner: '@bob:x', ts: 200 }] });
    await markPostsSeen(mx, space);
    expect(hasNewPosts(mx, space)).toBe(false);
    await markPostsSeen(mx, space);
    expect(setAccountData).toHaveBeenCalledTimes(1);
  });
});
