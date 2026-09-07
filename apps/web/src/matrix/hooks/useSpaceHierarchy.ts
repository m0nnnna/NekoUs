import { useEffect, useState } from 'react';
import { RoomType, type IPublicRoomsChunkRoom } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';

// matrix-js-sdk's own `IHierarchyRoom`/`IRoomHierarchy` (the real return-type names for
// getRoomHierarchy) exist in its source but aren't re-exported from the package root — only
// their common base, IPublicRoomsChunkRoom, is. Same situation as directory.ts's PublicRoomsPage.
export type HierarchyChannel = IPublicRoomsChunkRoom;

const PAGE_SIZE = 50;
/** Guards against a runaway pagination loop (a misbehaving homeserver returning an endless
 *  `next_batch`) — no real Space needs more than a few hundred channels listed here. */
const MAX_PAGES = 20;

/**
 * The Space's full channel hierarchy via `GET /rooms/{spaceId}/hierarchy` — unlike
 * `useSpaceRooms` (which only ever sees children this client already has a local `Room` object
 * for, i.e. rooms you're already joined to or invited to), this is how the app finds out a
 * channel exists in a Space **before** joining it, so ChannelList can offer a Join button for it
 * instead of the channel being invisible until someone invites you. `maxDepth: 1` and filtering
 * out `m.space` entries matches `useSpaceRooms`'s own scope cut — nested sub-space navigation
 * isn't supported, so a sub-space's own children aren't surfaced here either.
 *
 * Not live: there's no push event for "a Space's hierarchy changed," so this only fetches on
 * mount/space-change, the same honest-scope tradeoff `reconcileSpaceNickname` makes. A join
 * doesn't need a refetch — `mx.getRoomHierarchy`'s entries are cross-referenced against the
 * live-updating `useSpaceRooms` list at render time (see ChannelList.tsx), so an entry
 * disappearing from "not yet joined" the moment you actually join needs no extra plumbing here.
 */
export function useSpaceHierarchy(spaceId: string | null): HierarchyChannel[] {
  const mx = useMatrixClient();
  const [rooms, setRooms] = useState<HierarchyChannel[]>([]);

  useEffect(() => {
    if (!spaceId) {
      setRooms([]);
      return undefined;
    }

    let cancelled = false;
    setRooms([]);

    (async () => {
      const collected: HierarchyChannel[] = [];
      let from: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        let result;
        try {
          result = await mx.getRoomHierarchy(spaceId, PAGE_SIZE, 1, false, from);
        } catch {
          break; // e.g. a homeserver that doesn't support /hierarchy — just show nothing extra
        }
        // The root Space itself is always the first entry — only its children are relevant here.
        collected.push(...result.rooms.filter((r) => r.room_id !== spaceId && r.room_type !== RoomType.Space));
        if (!result.next_batch) break;
        from = result.next_batch;
      }
      if (!cancelled) setRooms(collected);
    })();

    return () => {
      cancelled = true;
    };
  }, [mx, spaceId]);

  return rooms;
}
