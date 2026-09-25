import { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { globalFeedOpenAtom } from '../../app/state/selection';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { setFollowing } from '../../matrix/follows';
import { filterPosts } from '../../matrix/globalFeed';
import { useFollows } from '../../matrix/hooks/useFollows';
import { useGlobalFeed } from '../../matrix/hooks/useGlobalFeed';
import { useSpaces } from '../../matrix/hooks/useSpaces';
import { GlobalPostList } from './GlobalPostList';
import { PostComposer } from './PostComposer';
import { useComposerTargets } from './useComposerTargets';
import './FeedView.css';
import './GlobalFeedView.css';

type Tab = 'everyone' | 'following';

/**
 * The global feed. **Everyone** is posts from public places only — people's Global posts and
 * public Spaces, including ones you haven't joined. **Following** is the people and whole Spaces
 * you follow, which may include Spaces you're a member of that aren't public (you can already
 * read those; nobody else sees them here).
 */
export function GlobalFeedView() {
  const mx = useMatrixClient();
  const open = useAtomValue(globalFeedOpenAtom);
  const setGlobalFeedOpen = useSetAtom(globalFeedOpenAtom);
  const feed = useGlobalFeed(open);
  const follows = useFollows();
  const joinedSpaces = useSpaces();
  const targets = useComposerTargets(feed.publicSpaceIds);
  const [tab, setTab] = useState<Tab>('everyone');
  const [managing, setManaging] = useState(false);
  const [followError, setFollowError] = useState<string>();

  const shown =
    tab === 'everyone'
      ? filterPosts(feed.posts, { kind: 'everyone' })
      : filterPosts(feed.posts, { kind: 'following', users: follows.users, spaces: follows.spaces });
  const followsNothing = follows.users.length === 0 && follows.spaces.length === 0;

  // Spaces worth offering to follow: every public one, plus your own — de-duplicated, by name.
  const followableSpaces = [
    ...feed.publicSpaces,
    ...joinedSpaces
      .filter((space) => !feed.publicSpaceIds.has(space.roomId))
      .map((space) => ({ roomId: space.roomId, name: space.name })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (kind: 'user' | 'space', id: string) => {
    setFollowError(undefined);
    setFollowing(mx, kind, id).catch((err) => setFollowError(err instanceof Error ? err.message : 'Couldn’t update follows'));
  };

  const nameOfUser = (userId: string) =>
    feed.posts.find((post) => post.source.owner === userId)?.source.ownerName ?? mx.getUser(userId)?.displayName ?? userId;

  const showManager = tab === 'following' && (managing || followsNothing);

  return (
    <main className="nu-main-pane" data-nu-role="main-pane">
      <div className="nu-main-pane__header" data-nu-role="main-pane-header">
        <button
          type="button"
          className="nu-main-pane__header-back"
          data-nu-role="main-pane-back"
          title="Close the global feed"
          aria-label="Close the global feed"
          onClick={() => setGlobalFeedOpen(false)}
        >
          <Icon name="arrowLeft" size={18} />
        </button>
        <Icon name="globe" size={20} className="nu-main-pane__header-icon" />
        <h1 className="nu-main-pane__header-name">Global feed</h1>
        <div className="nu-main-pane__header-actions">
          <div className="nu-feed__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'everyone'}
              className={tab === 'everyone' ? 'nu-feed__tab nu-feed__tab--active' : 'nu-feed__tab'}
              data-nu-role="global-feed-tab-everyone"
              onClick={() => setTab('everyone')}
            >
              Everyone
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'following'}
              className={tab === 'following' ? 'nu-feed__tab nu-feed__tab--active' : 'nu-feed__tab'}
              data-nu-role="global-feed-tab-following"
              onClick={() => setTab('following')}
            >
              Following
            </button>
          </div>
          <button
            type="button"
            className="nu-main-pane__header-action"
            data-nu-role="global-feed-refresh"
            title="Refresh"
            aria-label="Refresh"
            disabled={feed.loading}
            onClick={feed.refresh}
          >
            <Icon name="refresh" size={17} />
          </button>
        </div>
      </div>

      <div className="nu-feed" data-nu-role="global-feed">
        <PostComposer targets={targets} ready={feed.directoryLoaded} placeholder="What’s happening?" onPublished={feed.addSource} />

        {tab === 'following' && !followsNothing && (
          <button
            type="button"
            className="nu-global-feed__manage-toggle"
            data-nu-role="global-feed-manage-follows"
            aria-expanded={managing}
            onClick={() => setManaging((m) => !m)}
          >
            <Icon name={managing ? 'chevronDown' : 'chevronRight'} size={14} />
            Following {follows.users.length} {follows.users.length === 1 ? 'person' : 'people'} and {follows.spaces.length}{' '}
            {follows.spaces.length === 1 ? 'space' : 'spaces'}
          </button>
        )}

        {showManager && (
          <section className="nu-global-feed__follows" data-nu-role="global-feed-follows">
            {followsNothing && (
              <p className="nu-global-feed__follows-intro">
                Follow whole spaces here, or people from their profile (click any name). Their posts collect in this
                tab.
              </p>
            )}
            {follows.users.length > 0 && (
              <div className="nu-global-feed__follow-group">
                <h3 className="nu-global-feed__follow-heading">People</h3>
                {follows.users.map((userId) => (
                  <div className="nu-global-feed__follow-row" key={userId}>
                    <span className="nu-global-feed__follow-name">{nameOfUser(userId)}</span>
                    <button type="button" className="nu-follow-button nu-follow-button--on" onClick={() => toggle('user', userId)}>
                      Following
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="nu-global-feed__follow-group">
              <h3 className="nu-global-feed__follow-heading">Spaces</h3>
              {followableSpaces.length === 0 && <p className="nu-global-feed__follows-intro">No spaces to follow yet.</p>}
              {followableSpaces.map((space) => {
                const on = follows.spaces.includes(space.roomId);
                return (
                  <div className="nu-global-feed__follow-row" key={space.roomId}>
                    <span className="nu-global-feed__follow-name">
                      {space.name}
                      {!feed.publicSpaceIds.has(space.roomId) && <span className="nu-global-feed__follow-note"> (members only)</span>}
                    </span>
                    <button
                      type="button"
                      className={on ? 'nu-follow-button nu-follow-button--on' : 'nu-follow-button'}
                      data-nu-role="global-feed-follow-space"
                      aria-pressed={on}
                      onClick={() => toggle('space', space.roomId)}
                    >
                      {on ? 'Following' : 'Follow'}
                    </button>
                  </div>
                );
              })}
            </div>
            {followError && <p className="nu-field__error">{followError}</p>}
          </section>
        )}

        {feed.error && (
          <p className="nu-field__error" data-nu-role="global-feed-error">
            {feed.error}
          </p>
        )}

        <GlobalPostList posts={shown} targets={targets} onReposted={feed.addSource} />

        {feed.loading && (
          <p className="nu-feed__status" data-nu-role="global-feed-loading">
            Gathering posts…
          </p>
        )}
        {!feed.loading && !feed.error && shown.length === 0 && (
          <p className="nu-feed__status" data-nu-role="global-feed-empty">
            {tab === 'everyone'
              ? 'Nothing posted publicly yet. Post to Global and it shows up here.'
              : followsNothing
                ? 'You’re not following anyone yet.'
                : 'Nothing new from the people and spaces you follow.'}
          </p>
        )}
        {!feed.loading && tab === 'everyone' && feed.unreadableSpaces > 0 && (
          <p className="nu-global-feed__note" data-nu-role="global-feed-unreadable">
            {feed.unreadableSpaces === 1
              ? '1 public space isn’t shown because its posts can only be read by its members.'
              : `${feed.unreadableSpaces} public spaces aren’t shown because their posts can only be read by their members.`}
          </p>
        )}
        {!feed.loading && feed.hasMore && (
          <button
            type="button"
            className="nu-button nu-button--secondary nu-feed__load-more"
            data-nu-role="global-feed-load-more"
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
