import { RoomType, type IPublicRoomsChunkRoom, type MatrixClient } from 'matrix-js-sdk';

const PAGE_SIZE = 30;

// matrix-js-sdk declares this shape (as the resolved type of mx.publicRooms()) but doesn't
// export it — IPublicRoomsChunkRoom is exported, the response wrapper around it isn't.
export type PublicRoomsPage = {
  chunk: IPublicRoomsChunkRoom[];
  next_batch?: string;
  prev_batch?: string;
  total_room_count_estimate?: number;
};

/**
 * Browses the local homeserver's public room directory (no `server` option — scoped to this
 * account's own server, not cross-federation search, matching the narrower reach every other
 * "find something" flow in this app uses, e.g. AddExistingChannelModal). Returns both public
 * Spaces and plain public rooms mixed together, same as the raw API — DiscoverModal is what
 * decides how to badge/present the difference (see isSpaceEntry below).
 */
export function browsePublicRooms(
  mx: MatrixClient,
  { searchTerm, since }: { searchTerm?: string; since?: string } = {}
): Promise<PublicRoomsPage> {
  const trimmed = searchTerm?.trim();
  return mx.publicRooms({
    limit: PAGE_SIZE,
    since,
    filter: trimmed ? { generic_search_term: trimmed } : undefined,
  });
}

export function isSpaceEntry(entry: IPublicRoomsChunkRoom): boolean {
  return entry.room_type === RoomType.Space;
}

/** Joins a public directory entry by room ID (aliases resolve the same way — matrix-js-sdk's
 *  joinRoom accepts either) and hands back the joined room's actual ID, for navigating there. */
export async function joinPublicRoom(mx: MatrixClient, roomIdOrAlias: string): Promise<string> {
  const room = await mx.joinRoom(roomIdOrAlias);
  return room.roomId;
}
