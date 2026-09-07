import { useEffect, useState } from 'react';
import { useMatrixClient } from '../MatrixClientContext';
import { getExtendedProfile, type ExtendedProfile } from '../extendedProfile';

/**
 * Fetches a user's bio/banner/animated-avatar-flag on demand — see extendedProfile.ts for why
 * this can't be "live" the way displayname/avatar_url are (no sync delivery for MSC4133 fields).
 * Refetches whenever `userId` changes (e.g. a profile modal switching targets); callers that
 * need a fresh read after the *viewed* user's own edit (there is no such case today — only your
 * own profile is editable) would need their own refresh trigger, not provided here.
 */
export function useExtendedProfile(userId: string | undefined): { profile: ExtendedProfile; loading: boolean } {
  const mx = useMatrixClient();
  const [profile, setProfile] = useState<ExtendedProfile>({});
  const [loading, setLoading] = useState(!!userId);

  useEffect(() => {
    if (!userId) {
      setProfile({});
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    getExtendedProfile(mx, userId).then((result) => {
      if (!cancelled) {
        setProfile(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mx, userId]);

  return { profile, loading };
}
