import { useMemo } from 'react';
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

/** Reposts only go to public places. */
export function publicTargets(targets: ComposerTarget[]): ComposerTarget[] {
  return targets.filter((target) => target.target.kind === 'global' || target.isPublic);
}
