import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { followSpaceFeeds } from '../feed';
import {
  dedupeSources,
  fetchFeedPage,
  GLOBAL_FEED_CONCURRENCY,
  listDirectory,
  loadProfileSource,
  loadPublicSpaceSources,
  mapWithConcurrency,
  MAX_FEEDS,
  mergePosts,
  ownProfileSource,
  postsFromEvents,
  privateJoinedSpaces,
  privateJoinedSpaceSources,
  type FeedSource,
  type GlobalPost,
} from '../globalFeed';

export type GlobalFeed = {
  /** Every post from every readable source. Views narrow it with `filterPosts`. */
  posts: GlobalPost[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Listed Spaces — the only Spaces a repost may come from or go to. */
  publicSpaceIds: Set<string>;
  /** Public Spaces from the directory, for "Spaces to follow". */
  publicSpaces: { roomId: string; name: string }[];
  /** Whether the directory has answered — until then, which Spaces are public is unknown. */
  directoryLoaded: boolean;
  unreadableSpaces: number;
  error?: string;
  loadMore: () => void;
  refresh: () => void;
  /** After posting into a feed room this feed didn't know about yet (a first post creates it). */
  addSource: (source: FeedSource) => void;
};

/**
 * Everything the global feed, the Following timeline, and profiles read from — see
 * matrix/globalFeed.ts for what each source is and why Everyone is public-only.
 *
 * All sources are paged together (a timeline sorted across authors can't be paged one feed at
 * a time without misordering). Joined feed rooms update live; the rest are a snapshot, re-read
 * by `refresh`.
 */
export function useGlobalFeed(enabled: boolean): GlobalFeed {
  const mx = useMatrixClient();
  const [posts, setPosts] = useState<GlobalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [publicSpaces, setPublicSpaces] = useState<{ roomId: string; name: string }[]>([]);
  const [directoryLoaded, setDirectoryLoaded] = useState(false);
  const [unreadableSpaces, setUnreadableSpaces] = useState(0);
  const [error, setError] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const tokensRef = useRef(new Map<string, string>());
  const sourcesRef = useRef(new Map<string, FeedSource>());
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    tokensRef.current = new Map();
    sourcesRef.current = new Map();
    busyRef.current = true;
    setLoading(true);
    setError(undefined);

    void (async () => {
      try {
        const directory = await listDirectory(mx);
        if (cancelled) return;
        setPublicSpaces(directory.spaces.map(({ roomId, name }) => ({ roomId, name })));
        setDirectoryLoaded(true);
        const publicIds = new Set(directory.spaces.map((space) => space.roomId));

        // A private Space's feed rooms are members-only (feed.ts), so reading them means joining
        // them — which a member of the Space may do, and the Space's own Posts page does too.
        await mapWithConcurrency(privateJoinedSpaces(mx, publicIds), GLOBAL_FEED_CONCURRENCY, (space) =>
          followSpaceFeeds(mx, space)
        );
        if (cancelled) return;

        const [spaceResults, profileResults, own] = await Promise.all([
          mapWithConcurrency(directory.spaces, GLOBAL_FEED_CONCURRENCY, (space) => loadPublicSpaceSources(mx, space)),
          mapWithConcurrency(directory.profiles, GLOBAL_FEED_CONCURRENCY, (profile) => loadProfileSource(mx, profile.roomId)),
          ownProfileSource(mx),
        ]);
        if (cancelled) return;
        // `null` = won't show its state to non-members; `undefined` = the request failed.
        setUnreadableSpaces(spaceResults.filter((sources) => !sources).length);

        const sources = dedupeSources([
          ...spaceResults.flatMap((list) => list ?? []),
          ...profileResults.filter((source): source is FeedSource => !!source),
          ...(own ? [own] : []),
          ...privateJoinedSpaceSources(mx, publicIds),
        ]).slice(0, MAX_FEEDS);
        sources.forEach((source) => sourcesRef.current.set(source.roomId, source));

        const pages = await mapWithConcurrency(sources, GLOBAL_FEED_CONCURRENCY, (source) => fetchFeedPage(mx, source));
        if (cancelled) return;
        let merged: GlobalPost[] = [];
        pages.forEach((page, index) => {
          if (!page) return;
          merged = mergePosts(merged, page.posts);
          if (page.nextToken) tokensRef.current.set(sources[index].roomId, page.nextToken);
        });
        setPosts(merged);
        setHasMore(tokensRef.current.size > 0);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Couldn’t load posts');
      } finally {
        busyRef.current = false;
        if (!cancelled) setLoading(false);
      }
    })();

    const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
      const source = room && sourcesRef.current.get(room.roomId);
      if (!source) return;
      const incoming = postsFromEvents(source, [event]);
      if (incoming.length) setPosts((prev) => mergePosts(prev, incoming));
    };
    const onRedaction = (redaction: MatrixEvent) => {
      const redacted = redaction.event.redacts ?? redaction.getContent().redacts;
      if (redacted) setPosts((prev) => prev.filter((post) => post.eventId !== redacted));
    };
    mx.on(RoomEvent.Timeline, onTimeline);
    mx.on(RoomEvent.Redaction, onRedaction);
    return () => {
      cancelled = true;
      mx.removeListener(RoomEvent.Timeline, onTimeline);
      mx.removeListener(RoomEvent.Redaction, onRedaction);
    };
  }, [mx, enabled, generation]);

  const loadMore = useCallback(() => {
    if (busyRef.current || tokensRef.current.size === 0) return;
    busyRef.current = true;
    setLoadingMore(true);
    const pending = [...tokensRef.current.entries()];
    void mapWithConcurrency(pending, GLOBAL_FEED_CONCURRENCY, ([roomId, token]) => {
      const source = sourcesRef.current.get(roomId);
      return source ? fetchFeedPage(mx, source, token) : Promise.resolve(undefined);
    }).then((pages) => {
      let incoming: GlobalPost[] = [];
      pages.forEach((page, index) => {
        const [roomId] = pending[index];
        if (!page) return; // keeps its token, so the next "load older" retries it
        incoming = incoming.concat(page.posts);
        if (page.nextToken) tokensRef.current.set(roomId, page.nextToken);
        else tokensRef.current.delete(roomId);
      });
      setPosts((prev) => mergePosts(prev, incoming));
      setHasMore(tokensRef.current.size > 0);
      setLoadingMore(false);
      busyRef.current = false;
    });
  }, [mx]);

  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  const addSource = useCallback(
    (source: FeedSource) => {
      if (sourcesRef.current.has(source.roomId)) return;
      sourcesRef.current.set(source.roomId, source);
      void fetchFeedPage(mx, source)
        .then((page) => setPosts((prev) => mergePosts(prev, page.posts)))
        .catch(() => undefined);
    },
    [mx]
  );

  const publicSpaceIds = new Set(publicSpaces.map((space) => space.roomId));

  return {
    posts,
    loading,
    loadingMore,
    hasMore,
    publicSpaceIds,
    publicSpaces,
    directoryLoaded,
    unreadableSpaces,
    error,
    loadMore,
    refresh,
    addSource,
  };
}
