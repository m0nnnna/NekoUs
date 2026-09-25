import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClientEvent,
  Direction,
  MatrixEventEvent,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { applyPostEdits, editTargetOf, followSpaceFeeds, getOwnFeedRoomId, isPostEvent, listSpaceFeeds } from '../feed';

/** How many events to ask each feed room for per pass. Posts are sparse compared to chat, so a
 *  page of raw timeline events can easily contain only one or two of them. */
const PAGE_SIZE = 40;

export type FeedPost = {
  eventId: string;
  roomId: string;
  sender: string;
  ts: number;
  event: MatrixEvent;
};

/**
 * The hub timeline: every member's posts in one list, newest first.
 *
 * It's a client-side merge rather than a room, because the posts genuinely live in one room per
 * author (see `feed.ts` for why that shape was chosen). `mentionInbox.ts` already merges across
 * rooms the same way, and at hub scale — tens of members, not thousands — sorting the union of
 * their live timelines costs nothing worth optimizing.
 */
function collectPosts(mx: ReturnType<typeof useMatrixClient>, space: Room): FeedPost[] {
  const feeds = listSpaceFeeds(space);

  // Your own feed, in case your member event hasn't come back around through sync yet — posting
  // for the first time and not seeing your own post is a bad enough first impression to guard
  // against specifically.
  const ownRoomId = getOwnFeedRoomId(mx, space.roomId);
  const myUserId = mx.getUserId() ?? '';
  if (ownRoomId && !feeds.some((feed) => feed.roomId === ownRoomId)) {
    feeds.push({ userId: myUserId, roomId: ownRoomId });
  }

  const posts: FeedPost[] = [];
  feeds.forEach(({ userId, roomId }) => {
    const room = mx.getRoom(roomId);
    if (!room || room.getMyMembership() !== 'join') return;
    const events = room.getLiveTimeline().getEvents();
    const roomPosts: MatrixEvent[] = [];
    events.forEach((event) => {
      // A feed is *its owner's* timeline by definition. Power levels already stop anyone else
      // posting there, so this only ever matters for a room whose levels were edited by hand.
      if (!isPostEvent(event) || event.getSender() !== userId) return;
      const eventId = event.getId();
      if (!eventId) return;
      roomPosts.push(event);
      posts.push({ eventId, roomId, sender: userId, ts: event.getTs(), event });
    });
    applyPostEdits(roomPosts, events.filter((event) => !!editTargetOf(event)));
  });

  return posts.sort((a, b) => b.ts - a.ts);
}

/** The feed rooms this client is actually in, which is the set anything can read from. */
function joinedFeedRooms(mx: MatrixClient, space: Room): Room[] {
  const roomIds = new Set(listSpaceFeeds(space).map((feed) => feed.roomId));
  const own = getOwnFeedRoomId(mx, space.roomId);
  if (own) roomIds.add(own);
  return [...roomIds]
    .map((roomId) => mx.getRoom(roomId))
    .filter((room): room is Room => !!room && room.getMyMembership() === 'join');
}

/** Whether any feed still has older events to fetch — a back-pagination token is the SDK's own
 *  "there is more behind this" marker, so no guessing from how much came back. */
function anyRoomHasOlder(rooms: Room[]): boolean {
  return rooms.some((room) => room.getLiveTimeline().getPaginationToken(Direction.Backward) !== null);
}

/**
 * Pulls one page of older events out of every feed at once.
 *
 * Every feed has to be paginated together rather than one at a time: the view is a merge sorted
 * by timestamp, so fetching only the room that happens to hold the oldest post would let a
 * newer post from another feed appear *below* it once that one is finally paginated. Rooms with
 * nothing older left are skipped, and a room that fails is skipped rather than failing the pass.
 */
async function paginateAll(mx: MatrixClient, rooms: Room[]): Promise<void> {
  await Promise.all(
    rooms
      .filter((room) => room.getLiveTimeline().getPaginationToken(Direction.Backward) !== null)
      .map((room) =>
        mx
          .paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: PAGE_SIZE })
          .catch(() => false)
      )
  );
}

export type SpaceFeed = {
  posts: FeedPost[];
  /** The first pass — joining everyone's feed rooms and filling a first screenful. */
  loading: boolean;
  /** A pass triggered by `loadMore`. */
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
};

/**
 * Posts across the Space.
 *
 * Joining every feed room is part of loading, not a side errand: reading a `world_readable` room
 * you aren't in requires peeking, which is the least reliably supported corner of the
 * client-server API, so the hub joins instead.
 *
 * A freshly joined room arrives with only whatever `/sync` chose to include, which for a room
 * nobody has touched in a while can be nothing at all — so the first pass also paginates until
 * it has a screenful. Without that the hub looks empty in exactly the case where it should be
 * fullest: the first time you open it.
 */
export function useSpaceFeed(space: Room | null): SpaceFeed {
  const mx = useMatrixClient();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  // Guards against a second pass starting while one is in flight — two overlapping paginations
  // of the same timeline race for the same token and one of them wastes its page.
  const paginatingRef = useRef(false);

  const loadMore = useCallback(() => {
    if (!space || paginatingRef.current) return;
    paginatingRef.current = true;
    setLoadingMore(true);
    const rooms = joinedFeedRooms(mx, space);
    void paginateAll(mx, rooms).finally(() => {
      paginatingRef.current = false;
      setLoadingMore(false);
      setPosts(collectPosts(mx, space));
      setHasMore(anyRoomHasOlder(joinedFeedRooms(mx, space)));
    });
  }, [mx, space]);

  useEffect(() => {
    if (!space) {
      setPosts([]);
      setLoading(false);
      setHasMore(false);
      return undefined;
    }

    let cancelled = false;
    const update = () => {
      if (!cancelled) setPosts(collectPosts(mx, space));
    };

    update();
    setLoading(true);
    void (async () => {
      await followSpaceFeeds(mx, space).catch(() => undefined);
      if (cancelled) return;
      update();

      // Fill a first screenful. Capped rather than looping to exhaustion: a hub with years of
      // posts would otherwise page all the way back before showing anything.
      paginatingRef.current = true;
      for (let pass = 0; pass < 3; pass += 1) {
        const rooms = joinedFeedRooms(mx, space);
        if (!anyRoomHasOlder(rooms)) break;
        if (collectPosts(mx, space).length >= 10) break;
        await paginateAll(mx, rooms);
        if (cancelled) return;
      }
      paginatingRef.current = false;

      if (cancelled) return;
      setLoading(false);
      setHasMore(anyRoomHasOlder(joinedFeedRooms(mx, space)));
      update();
    })();

    // Broad listeners rather than per-room ones: which rooms are in the merge is itself a moving
    // target while the join pass runs, so subscribing per room would mean re-subscribing every
    // time one lands.
    const onTimeline = () => update();
    const onDecrypted = (event: MatrixEvent) => {
      if (isPostEvent(event)) update();
    };
    mx.on(RoomEvent.Timeline, onTimeline);
    mx.on(RoomEvent.Redaction, onTimeline);
    mx.on(RoomEvent.LocalEchoUpdated, onTimeline);
    mx.on(ClientEvent.Room, onTimeline);
    mx.on(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      cancelled = true;
      mx.removeListener(RoomEvent.Timeline, onTimeline);
      mx.removeListener(RoomEvent.Redaction, onTimeline);
      mx.removeListener(RoomEvent.LocalEchoUpdated, onTimeline);
      mx.removeListener(ClientEvent.Room, onTimeline);
      mx.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [mx, space]);

  return { posts, loading, loadingMore, hasMore, loadMore };
}
