import { useEffect } from 'react';
import { EventType, RoomEvent, RoomStateEvent, type MatrixEvent, type Room, type RoomState } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import {
  autoJoinNewChannel,
  autoJoinSpaceChannels,
  clearLeavingSpace,
  forgetLeftChannel,
  isDeliberateChannelLeave,
  rememberLeftChannel,
} from '../../matrix/autoJoin';
import { FEED_ROOM_MEMBER_KEY, feedJoinVia, followSpaceFeeds } from '../../matrix/feed';
import { findParentSpaceId } from '../../matrix/spaceChildren';

/**
 * State events older than this, relative to when the app started, are history rather than news —
 * a channel that already existed, not one just added. Generous, to cover clock skew between this
 * machine and the homeserver.
 */
const LIVE_EVENT_SLACK_MS = 60_000;

/** Joining feed rooms waits a little after start, out of the way of the first screen loading. */
const FEED_JOIN_DELAY_MS = 5_000;

/** Runs `then` once the room knows its own type — right after a join, its state may still be
 *  arriving, and a Space looks like any other room until `m.room.create` lands. */
function onceTypeKnown(room: Room, then: () => void): (() => void) | undefined {
  if (room.currentState.getStateEvents(EventType.RoomCreate, '')) {
    then();
    return undefined;
  }
  const onState = (event: MatrixEvent) => {
    if (event.getType() !== EventType.RoomCreate) return;
    room.removeListener(RoomStateEvent.Events, onState);
    then();
  };
  room.on(RoomStateEvent.Events, onState);
  return () => room.removeListener(RoomStateEvent.Events, onState);
}

/**
 * Keeps you in your Spaces' channels (matrix/autoJoin.ts). Renders nothing. Mounted in the app
 * shell, which only renders after the first sync — so everything it hears is a live change, never
 * the replay of rooms you were already in.
 *
 * - You join a Space → join its channels, and its members' feed rooms (so their posts, and any
 *   @mention of you in one, reach you; feed.ts).
 * - A member of a Space you're in publishes a feed → join it.
 * - A channel is added to a Space you're in → join it.
 * - You leave (or are removed from) one of a Space's channels → remember not to rejoin it; join
 *   it again yourself and it's forgotten.
 */
export function SpaceAutoJoiner() {
  const mx = useMatrixClient();

  useEffect(() => {
    const startedAt = Date.now();
    // Only waits still in progress (onceTypeKnown), so they can be cancelled on unmount.
    const pending = new Set<() => void>();

    const handleMembership = (room: Room, membership: string, prevMembership?: string) => {
      if (room.isSpaceRoom()) {
        if (membership === 'join') {
          clearLeavingSpace(room.roomId);
          void autoJoinSpaceChannels(mx, room.roomId)
            .catch(() => undefined)
            .then(() => followSpaceFeeds(mx, room))
            .catch(() => undefined);
        }
        return;
      }
      if (membership === 'join') {
        void forgetLeftChannel(mx, room.roomId).catch(() => undefined);
      } else if ((membership === 'leave' || membership === 'ban') && prevMembership === 'join') {
        // Leaving a whole Space leaves its channels too; that isn't leaving any one of them.
        const parentId = findParentSpaceId(mx, room.roomId);
        if (parentId && isDeliberateChannelLeave(mx, parentId)) void rememberLeftChannel(mx, room.roomId).catch(() => undefined);
      }
    };

    const onMyMembership = (room: Room, membership: string, prevMembership?: string) => {
      if (membership === prevMembership) return;
      // A holder rather than a plain variable: when the type is already known the callback runs
      // before onceTypeKnown returns, i.e. before there's anything to remove.
      const wait: { cancel?: () => void } = {};
      wait.cancel = onceTypeKnown(room, () => {
        if (wait.cancel) pending.delete(wait.cancel);
        handleMembership(room, membership, prevMembership);
      });
      if (wait.cancel) pending.add(wait.cancel);
    };

    // Members' feed rooms too, not only when the Posts page opens: a room's events (and so a
    // post's @mention of you) only reach people joined to it. Once shortly after start, for every
    // Space, one at a time so a big server doesn't fire a burst of joins; then as they change.
    const startupFeeds = setTimeout(() => {
      void (async () => {
        const spaces = mx.getRooms().filter((room) => room.isSpaceRoom() && room.getMyMembership() === 'join');
        for (const space of spaces) await followSpaceFeeds(mx, space).catch(() => undefined);
      })();
    }, FEED_JOIN_DELAY_MS);

    const onMemberState = (event: MatrixEvent, state: RoomState) => {
      if (event.getTs() < startedAt - LIVE_EVENT_SLACK_MS) return;
      const userId = event.getStateKey();
      const content = event.getContent();
      const feedRoomId = content[FEED_ROOM_MEMBER_KEY];
      if (!userId || userId === mx.getUserId() || content.membership !== 'join' || typeof feedRoomId !== 'string') return;
      const space = mx.getRoom(state.roomId);
      if (!space?.isSpaceRoom() || space.getMyMembership() !== 'join') return;
      if (mx.getRoom(feedRoomId)?.getMyMembership() === 'join') return;
      void mx.joinRoom(feedRoomId, { viaServers: feedJoinVia(feedRoomId, userId) }).catch(() => undefined);
    };

    const onState = (event: MatrixEvent, state: RoomState) => {
      if (event.getType() === EventType.RoomMember) {
        onMemberState(event, state);
        return;
      }
      if (event.getType() !== EventType.SpaceChild) return;
      if (event.getTs() < startedAt - LIVE_EVENT_SLACK_MS) return;
      const childId = event.getStateKey();
      const via = event.getContent().via;
      if (!childId || !Array.isArray(via) || via.length === 0) return; // a removal, not an addition
      const space = mx.getRoom(state.roomId);
      if (!space?.isSpaceRoom() || space.getMyMembership() !== 'join') return;
      void autoJoinNewChannel(mx, state.roomId, childId).catch(() => undefined);
    };

    mx.on(RoomEvent.MyMembership, onMyMembership);
    mx.on(RoomStateEvent.Events, onState);
    return () => {
      clearTimeout(startupFeeds);
      mx.removeListener(RoomEvent.MyMembership, onMyMembership);
      mx.removeListener(RoomStateEvent.Events, onState);
      pending.forEach((cancel) => cancel());
    };
  }, [mx]);

  return null;
}
