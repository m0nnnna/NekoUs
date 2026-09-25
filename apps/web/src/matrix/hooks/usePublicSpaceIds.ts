import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { listDirectory } from '../globalFeed';
import { isListedInDirectory } from '../spaceDirectory';

/** How long a read is reused. Whether a Space is listed changes rarely — and when it's changed
 *  from here, invalidatePublicSpaceIds() drops the cache right away. */
const TTL_MS = 60_000;
let cached: { at: number; promise: Promise<Set<string>> } | undefined;
const listeners = new Set<() => void>();

/**
 * Your own Spaces are asked about one by one (a definite answer per Space, spaceDirectory.ts);
 * the directory listing adds public Spaces you aren't in. Asking only the listing is what used to
 * miss Spaces: it's paged and capped, so on a busy directory a listed Space could simply not be
 * on the pages read.
 */
async function readPublicSpaceIds(mx: MatrixClient): Promise<Set<string>> {
  const mySpaces = mx.getRooms().filter((room) => room.isSpaceRoom() && room.getMyMembership() === 'join');
  const [directory, checks] = await Promise.all([
    listDirectory(mx).catch(() => ({ spaces: [] })),
    Promise.all(
      mySpaces.map((space) =>
        isListedInDirectory(mx, space.roomId)
          .then((listed) => (listed ? space.roomId : undefined))
          .catch(() => undefined)
      )
    ),
  ]);
  const ids = new Set(directory.spaces.map((space) => space.roomId));
  checks.forEach((id) => id && ids.add(id));
  return ids;
}

function loadPublicSpaceIds(mx: MatrixClient): Promise<Set<string>> {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const promise = readPublicSpaceIds(mx).catch(() => {
      cached = undefined; // don't keep serving a failed read
      return new Set<string>();
    });
    cached = { at: Date.now(), promise };
  }
  return cached.promise;
}

/** After listing or unlisting a Space here: every view re-reads now instead of a minute later. */
export function invalidatePublicSpaceIds(): void {
  cached = undefined;
  listeners.forEach((listener) => listener());
}

/**
 * Which Spaces are listed in the directory (public) — for a view that needs to know without
 * loading the whole global feed, like a Space's own Posts page deciding what can be reposted and
 * how to store a post's media. `loaded` is false until it's known: a caller must not post into a
 * Space before then, since public-or-not decides who can read the post.
 */
export function usePublicSpaceIds(): { ids: Set<string>; loaded: boolean } {
  const mx = useMatrixClient();
  const [state, setState] = useState<{ ids: Set<string>; loaded: boolean }>({ ids: new Set(), loaded: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = () => setRevision((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void loadPublicSpaceIds(mx).then((ids) => {
      if (!cancelled) setState({ ids, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [mx, revision]);
  return state;
}
