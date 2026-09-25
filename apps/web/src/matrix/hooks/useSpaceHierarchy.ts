import { useEffect, useState } from 'react';
import { RoomType } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { fetchSpaceChildren, type HierarchyEntry } from '../autoJoin';

// A hierarchy entry as the server sends it — see autoJoin.ts's HierarchyEntry.
export type HierarchyChannel = HierarchyEntry;

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
      let collected: HierarchyChannel[] = [];
      try {
        collected = (await fetchSpaceChildren(mx, spaceId)).filter((r) => r.room_type !== RoomType.Space);
      } catch {
        // e.g. a homeserver that doesn't support /hierarchy — just show nothing extra
      }
      if (!cancelled) setRooms(collected);
    })();

    return () => {
      cancelled = true;
    };
  }, [mx, spaceId]);

  return rooms;
}
