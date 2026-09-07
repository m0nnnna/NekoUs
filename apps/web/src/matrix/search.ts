import type { MatrixClient, SearchResult } from 'matrix-js-sdk';

/**
 * Server-side full-text search (`/search`) — scoped to one room when `roomId` is given,
 * otherwise across every room the search is allowed to touch. No "jump to this exact message
 * in its live timeline with surrounding context" here (that needs its own fetched timeline
 * window distinct from the one MessageTimeline.tsx reads — a real feature in its own right,
 * e.g. what Element calls permalinks); a result takes you to the room, not a scroll position.
 */
export async function searchMessages(mx: MatrixClient, term: string, roomId?: string): Promise<SearchResult[]> {
  const results = await mx.searchRoomEvents({
    term,
    filter: roomId ? { rooms: [roomId] } : undefined,
  });
  return results.results;
}
