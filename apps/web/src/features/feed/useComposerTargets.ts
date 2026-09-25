import { useMemo } from 'react';
import { canRepost, type PostOrigin } from '../../matrix/feed';
import { targetOrigin } from '../../matrix/postPublishing';
import { useSpaces } from '../../matrix/hooks/useSpaces';
import type { ComposerTarget } from './PostComposer';

export const GLOBAL_TARGET_ID = 'global';

/** Global first, then each of your Spaces — the destinations a post (or a repost) can go to. */
export function useComposerTargets(publicSpaceIds: Set<string>): ComposerTarget[] {
  const spaces = useSpaces();
  const publicKey = [...publicSpaceIds].sort().join('|');
  return useMemo(
    () => [
      { id: GLOBAL_TARGET_ID, label: 'Global', isPublic: true, target: { kind: 'global' } },
      ...spaces.map((space) => ({
        id: space.roomId,
        label: space.name || space.roomId,
        isPublic: publicSpaceIds.has(space.roomId),
        target: { kind: 'space' as const, space },
      })),
    ],
    // publicKey stands in for the Set, whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces, publicKey]
  );
}

/**
 * Where a post from `source` may be reposted, by canRepost's rule: between public places, or
 * within the Space it came from. Empty means no Repost button at all.
 */
export function repostTargetsFor(targets: ComposerTarget[], source: PostOrigin, sourceIsPublic: boolean): ComposerTarget[] {
  return targets.filter((target) => canRepost(source, sourceIsPublic, targetOrigin(target.target), target.isPublic));
}
