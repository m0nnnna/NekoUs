import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { listDirectory } from '../globalFeed';

/** How long a directory read is reused. Whether a Space is listed changes rarely. */
const TTL_MS = 60_000;
let cached: { at: number; promise: Promise<Set<string>> } | undefined;

function loadPublicSpaceIds(mx: MatrixClient): Promise<Set<string>> {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const promise = listDirectory(mx)
      .then(({ spaces }) => new Set(spaces.map((space) => space.roomId)))
      .catch(() => {
        cached = undefined; // don't keep serving a failed read
        return new Set<string>();
      });
    cached = { at: Date.now(), promise };
  }
  return cached.promise;
}

/**
 * Which Spaces are listed in the directory (public) — for a view that needs to know without
 * loading the whole global feed, like a Space's own Posts page deciding what can be reposted and
 * how to store a post's media. `loaded` is false until the directory has answered: a caller must
 * not post into a Space before then, since public-or-not decides who can read the post.
 */
export function usePublicSpaceIds(): { ids: Set<string>; loaded: boolean } {
  const mx = useMatrixClient();
  const [state, setState] = useState<{ ids: Set<string>; loaded: boolean }>({ ids: new Set(), loaded: false });
  useEffect(() => {
    let cancelled = false;
    void loadPublicSpaceIds(mx).then((ids) => {
      if (!cancelled) setState({ ids, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [mx]);
  return state;
}
