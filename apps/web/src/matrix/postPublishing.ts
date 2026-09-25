import type { MatrixClient, Room } from 'matrix-js-sdk';
import { ensureFeedRoom, publishPost, type PostContent, type PostOrigin } from './feed';
import type { FeedSource } from './globalFeed';
import { ensureProfileRoom } from './profileFeed';

/** Where a new post goes: your global profile feed, or your feed in one of your Spaces. */
export type PostTarget = { kind: 'global' } | { kind: 'space'; space: Room };

export function targetOrigin(target: PostTarget): PostOrigin {
  return target.kind === 'global' ? { kind: 'global' } : { kind: 'space', spaceId: target.space.roomId, spaceName: target.space.name };
}

/**
 * Publishes a post to its target, creating the feed room on first use, and hands back the source
 * it now lives in — so a timeline that didn't know about a brand-new feed can start reading it.
 */
export async function publishToTarget(
  mx: MatrixClient,
  target: PostTarget,
  content: PostContent,
  displayName: string,
  isPublic: boolean
): Promise<FeedSource> {
  const roomId =
    target.kind === 'global'
      ? await ensureProfileRoom(mx, displayName)
      : await ensureFeedRoom(mx, target.space, displayName, isPublic);
  await publishPost(mx, roomId, content);
  const owner = mx.getUserId() ?? '';
  return {
    roomId,
    owner,
    ownerName: displayName || owner,
    origin: targetOrigin(target),
    isPublic: target.kind === 'global' || isPublic,
  };
}
