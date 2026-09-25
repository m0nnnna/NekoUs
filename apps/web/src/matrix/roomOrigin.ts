import { EventType, type MatrixClient, type Room } from 'matrix-js-sdk';

/** The server-name half of a Matrix ID (`@user:server`, `!room:server`, ports included). Empty
 *  for an ID that has none — which from room version 12 on is every room ID. */
export function serverNameOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? '' : id.slice(colon + 1);
}

/**
 * The homeserver a room was created on, or undefined when that can't be told.
 *
 * Before room version 12 the room ID said so (`!abc:server`). From v12 on — what Continuwuity
 * creates — a room ID is a bare hash with no server in it, so anything that read the server off
 * the ID got an empty string. The answer in every room version is the server of whoever sent the
 * room's `m.room.create`, which a client has for every room it's joined or been invited to. Must
 * agree with the token server's copy (services/token-server/src/tenancy.ts, roomOriginServer).
 */
export function roomOriginServer(room: Room | null | undefined, roomId: string = room?.roomId ?? ''): string | undefined {
  const creator = room?.currentState.getStateEvents(EventType.RoomCreate, '')?.getSender();
  if (creator) return serverNameOf(creator);
  return serverNameOf(roomId) || undefined;
}

/**
 * Servers to join a room through when all you have is its ID and the Space it's in: the room ID's
 * own server where it still carries one, the Space's creator's server (which hosts the Space, so
 * it's in the room's federation), and your own. Never an empty entry — a server rejects a join
 * with an empty `via` outright.
 */
export function joinViaServers(mx: MatrixClient, roomId: string, spaceId?: string): string[] {
  const space = spaceId ? mx.getRoom(spaceId) : undefined;
  return [
    ...new Set(
      [serverNameOf(roomId), roomOriginServer(space, spaceId), serverNameOf(mx.getUserId() ?? '')].filter(
        (server): server is string => !!server
      )
    ),
  ];
}
