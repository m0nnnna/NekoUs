import { EventType, HistoryVisibility, JoinRule, Visibility, type MatrixClient, type Room } from 'matrix-js-sdk';

/**
 * Whether a Space is **public** in the sense posts care about: listed in the room directory.
 *
 * Two different things get called "public" and they're easy to confuse:
 * - **Listed** (this module): shows up in Discover, and its posts reach the global feed.
 * - **Public join link** (SpaceInviteLinkSettings): anyone *with the link* can join. Not listed,
 *   so its posts stay members-only.
 *
 * Asked of the server per room (`GET /directory/list/room/{roomId}`), which is a definite yes or
 * no — rather than hoping to spot the Space while paging through the whole directory, which is
 * capped and can miss it on a busy server.
 */
export async function isListedInDirectory(mx: MatrixClient, roomId: string): Promise<boolean> {
  const { visibility } = await mx.getRoomDirectoryVisibility(roomId);
  return visibility === Visibility.Public;
}

function currentHistoryVisibility(space: Room): string | undefined {
  return space.currentState
    .getStateEvents(EventType.RoomHistoryVisibility, '')
    ?.getContent<{ history_visibility?: string }>().history_visibility;
}

/**
 * Lists or unlists a Space — the same three settings a Space created as public gets
 * (roomCreation.ts): listed in the directory, `world_readable` (so the global feed can find its
 * members' feeds without joining), and joinable by anyone.
 *
 * Ordered so the Space is never listed before it's readable: listing opens it up first and
 * publishes last; unlisting withdraws it from the directory first. Unlisting leaves the join rule
 * alone — whether the invite link still works is that setting's call, not this one's.
 *
 * Members' feed rooms follow on their own: each feed's visibility is brought in line with its
 * Space the next time its owner posts (feed.ts, syncFeedVisibility).
 */
export async function setListedInDirectory(mx: MatrixClient, space: Room, listed: boolean): Promise<void> {
  const history = currentHistoryVisibility(space);
  if (listed) {
    if (history !== HistoryVisibility.WorldReadable) {
      await mx.sendStateEvent(space.roomId, EventType.RoomHistoryVisibility, { history_visibility: HistoryVisibility.WorldReadable }, '');
    }
    if (space.getJoinRule() !== JoinRule.Public) {
      await mx.sendStateEvent(space.roomId, EventType.RoomJoinRules, { join_rule: JoinRule.Public }, '');
    }
    await mx.setRoomDirectoryVisibility(space.roomId, Visibility.Public);
  } else {
    await mx.setRoomDirectoryVisibility(space.roomId, Visibility.Private);
    if (history === HistoryVisibility.WorldReadable) {
      await mx.sendStateEvent(space.roomId, EventType.RoomHistoryVisibility, { history_visibility: HistoryVisibility.Shared }, '');
    }
  }
}
