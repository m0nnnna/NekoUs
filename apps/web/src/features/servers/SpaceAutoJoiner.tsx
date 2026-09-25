import { useEffect } from 'react';
import { EventType, RoomEvent, RoomStateEvent, type MatrixEvent, type Room, type RoomState } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { autoJoinNewChannel, autoJoinSpaceChannels, forgetLeftChannel, rememberLeftChannel } from '../../matrix/autoJoin';
import { findParentSpaceId } from '../../matrix/spaceChildren';

/**
 * State events older than this, relative to when the app started, are history rather than news —
 * a channel that already existed, not one just added. Generous, to cover clock skew between this
 * machine and the homeserver.
 */
const LIVE_EVENT_SLACK_MS = 60_000;

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
 * - You join a Space → join its channels.
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
        if (membership === 'join') void autoJoinSpaceChannels(mx, room.roomId).catch(() => undefined);
        return;
      }
      if (membership === 'join') {
        void forgetLeftChannel(mx, room.roomId).catch(() => undefined);
      } else if ((membership === 'leave' || membership === 'ban') && prevMembership === 'join' && findParentSpaceId(mx, room.roomId)) {
        void rememberLeftChannel(mx, room.roomId).catch(() => undefined);
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

    const onState = (event: MatrixEvent, state: RoomState) => {
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
      mx.removeListener(RoomEvent.MyMembership, onMyMembership);
      mx.removeListener(RoomStateEvent.Events, onState);
      pending.forEach((cancel) => cancel());
    };
  }, [mx]);

  return null;
}
