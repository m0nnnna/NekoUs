import { useCallback } from 'react';
import { useSetAtom } from 'jotai';
import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { openPostAtom, type OpenPost } from '../../app/state/selection';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { applyPostEdits, readFeedMarker, readPost } from '../../matrix/feed';
import { editsFromRaw } from '../../matrix/globalFeed';
import { isListedInDirectory } from '../../matrix/spaceDirectory';
import { useOpenFeedRoom } from './useOpenFeedRoom';

/**
 * Everything a post's page needs, from just where the post is — for anything that holds a post's
 * ID but not the post (a mention in the inbox, a notification). Reads the post itself (one
 * `/event` request, with its latest edit when the server bundles it, which Continuwuity does) and
 * the feed's marker for where it lives. Undefined when it isn't a post, or can't be read.
 */
export async function loadOpenPost(mx: MatrixClient, roomId: string, postId: string): Promise<OpenPost | undefined> {
  const room = mx.getRoom(roomId);
  const marker = room ? readFeedMarker(room) : undefined;
  if (!room || !marker) return undefined;
  const raw = (await mx.fetchRoomEvent(roomId, postId)) as Record<string, any>;
  const event = new MatrixEvent(raw);
  applyPostEdits([event], editsFromRaw([raw]));
  const content = readPost(event);
  if (!content) return undefined;

  const sender = event.getSender() ?? marker.owner;
  const member = room.getMember(sender);
  const space = marker.spaceId && !marker.profile ? mx.getRoom(marker.spaceId) : null;
  const inSpace = space?.getMyMembership() === 'join';
  const isPublic = marker.profile || !marker.spaceId ? true : await isListedInDirectory(mx, marker.spaceId).catch(() => false);
  return {
    roomId,
    postId,
    isPublic,
    canInteract: marker.profile || inSpace,
    ...(!marker.profile && !inSpace && { cannotInteractReason: 'Join the Space to like or comment' }),
    content,
    author: { userId: sender, name: member?.name ?? sender, avatarUrl: member?.getMxcAvatarUrl() ?? null },
    ts: event.getTs(),
    edited: !!event.replacingEventId(),
    sourceOrigin:
      marker.spaceId && !marker.profile
        ? { kind: 'space', spaceId: marker.spaceId, spaceName: space?.name ?? marker.spaceId }
        : { kind: 'global' },
    showOrigin: true,
  };
}

/**
 * Opens one post on its own page. If the post can't be read, falls back to the posts view it
 * belongs to (useOpenFeedRoom), so the click still lands somewhere sensible. Resolves to whether
 * the room was a feed at all.
 */
export function useOpenPost(): (roomId: string, postId: string) => Promise<boolean> {
  const mx = useMatrixClient();
  const setOpenPost = useSetAtom(openPostAtom);
  const openFeedRoom = useOpenFeedRoom();
  return useCallback(
    async (roomId: string, postId: string) => {
      const room = mx.getRoom(roomId);
      if (!room || !readFeedMarker(room)) return false;
      const post = await loadOpenPost(mx, roomId, postId).catch(() => undefined);
      if (post) setOpenPost(post);
      else openFeedRoom(room);
      return true;
    },
    [mx, setOpenPost, openFeedRoom]
  );
}
