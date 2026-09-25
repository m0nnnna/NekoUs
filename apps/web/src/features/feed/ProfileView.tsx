import { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { profileUserIdAtom } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { setFollowing } from '../../matrix/follows';
import { filterPosts } from '../../matrix/globalFeed';
import { useExtendedProfile } from '../../matrix/hooks/useExtendedProfile';
import { useFollows } from '../../matrix/hooks/useFollows';
import { useGlobalFeed } from '../../matrix/hooks/useGlobalFeed';
import { useMediaUrl } from '../../matrix/hooks/useMediaUrl';
import { handleFor } from '../../matrix/roles';
import { GlobalPostList } from './GlobalPostList';
import { PostComposer } from './PostComposer';
import { useComposerTargets } from './useComposerTargets';
import './FeedView.css';
import './ProfileView.css';

/**
 * A person's page: banner, bio, a Follow button, and their posts — their Global posts, posts in
 * public Spaces, and posts in Spaces you share with them (you're a member of those; nobody else
 * sees them here). Your own profile gets a composer.
 */
export function ProfileView({ userId }: { userId: string }) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const isMe = userId === myUserId;
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const feed = useGlobalFeed(true);
  const follows = useFollows();
  const targets = useComposerTargets(feed.publicSpaceIds);
  const { profile: extended } = useExtendedProfile(userId);
  const bannerSrc = useMediaUrl(extended.bannerUrl, { width: 1200, height: 360, method: 'crop' });
  const [basic, setBasic] = useState<{ name: string; avatarUrl?: string }>(() => {
    const user = mx.getUser(userId);
    return { name: user?.displayName || userId, avatarUrl: user?.avatarUrl };
  });
  const [followError, setFollowError] = useState<string>();

  // The global profile, for someone you may share no rooms with (so no cached User).
  useEffect(() => {
    let cancelled = false;
    mx.getProfileInfo(userId)
      .then((info) => {
        if (!cancelled) setBasic({ name: info.displayname || userId, avatarUrl: info.avatar_url });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mx, userId]);

  const posts = filterPosts(feed.posts, { kind: 'profile', userId });
  const following = follows.users.includes(userId);

  return (
    <main className="nu-main-pane" data-nu-role="main-pane">
      <div className="nu-main-pane__header" data-nu-role="main-pane-header">
        <button
          type="button"
          className="nu-main-pane__header-back nu-profile-view__back"
          data-nu-role="profile-view-back"
          title="Back"
          aria-label="Back"
          onClick={() => setProfileUserId(null)}
        >
          <Icon name="arrowLeft" size={18} />
        </button>
        <h1 className="nu-main-pane__header-name">{basic.name}</h1>
      </div>

      <div className="nu-feed" data-nu-role="profile-view">
        <section className="nu-profile-view__card">
          <div
            className="nu-profile-view__banner"
            style={bannerSrc ? { backgroundImage: `url(${bannerSrc})` } : undefined}
            data-nu-role="profile-view-banner"
          />
          <div className="nu-profile-view__identity">
            <div className="nu-profile-view__avatar">
              <Avatar name={basic.name} mxcUrl={basic.avatarUrl ?? null} size={88} animated={extended.avatarAnimated} />
            </div>
            {!isMe && (
              <button
                type="button"
                className={following ? 'nu-follow-button nu-follow-button--on' : 'nu-follow-button'}
                data-nu-role="profile-follow"
                aria-pressed={following}
                onClick={() => {
                  setFollowError(undefined);
                  setFollowing(mx, 'user', userId).catch((err) =>
                    setFollowError(err instanceof Error ? err.message : 'Couldn’t update follows')
                  );
                }}
              >
                {following ? 'Following' : 'Follow'}
              </button>
            )}
          </div>
          <h2 className="nu-profile-view__name">{basic.name}</h2>
          <p className="nu-profile-view__handle">{handleFor(userId)}</p>
          {extended.bio && <p className="nu-profile-view__bio">{extended.bio}</p>}
          <p className="nu-profile-view__count">
            {feed.loading ? 'Loading posts…' : `${posts.length} ${posts.length === 1 ? 'post' : 'posts'}`}
          </p>
          {followError && <p className="nu-field__error">{followError}</p>}
        </section>

        {isMe && <PostComposer targets={targets} ready={feed.directoryLoaded} placeholder="Post something…" onPublished={feed.addSource} />}

        <GlobalPostList posts={posts} targets={targets} onReposted={feed.addSource} />

        {!feed.loading && posts.length === 0 && (
          <p className="nu-feed__status" data-nu-role="profile-view-empty">
            {isMe ? 'You haven’t posted anywhere yet.' : `${basic.name} hasn’t posted anywhere you can see.`}
          </p>
        )}
        {!feed.loading && feed.hasMore && (
          <button
            type="button"
            className="nu-button nu-button--secondary nu-feed__load-more"
            onClick={feed.loadMore}
            disabled={feed.loadingMore}
          >
            {feed.loadingMore ? 'Loading…' : 'Load older posts'}
          </button>
        )}
      </div>
    </main>
  );
}
