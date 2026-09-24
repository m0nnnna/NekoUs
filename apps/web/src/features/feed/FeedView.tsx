import { useMemo, useState, type FormEvent } from 'react';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { selectedSpaceViewAtom } from '../../app/state/selection';
import { Avatar } from '../../components/Avatar';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import {
  buildPostContent,
  deletePost,
  deletePrivatePost,
  ensureFeedRoom,
  makePostPrivate,
  publishPost,
  publishPrivatePost,
  readPost,
  readPrivatePosts,
  savePrivatePost,
  type PrivatePost,
} from '../../matrix/feed';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { useRoomEmotes } from '../../matrix/hooks/useRoomEmotes';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { useSpaceFeed, type FeedPost } from '../../matrix/hooks/useSpaceFeed';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import { renderMessageText } from '../messaging/renderMessageText';
import './FeedView.css';

/** Relative-ish timestamp — posts are browsed by recency, not read in sequence like a chat. */
function formatPostTime(ts: number): string {
  const elapsed = Date.now() - ts;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

type Tab = 'hub' | 'mine';

export function FeedView({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const { posts, loading, loadingMore, hasMore, loadMore } = useSpaceFeed(space);
  const members = useRoomMembers(space.roomId);
  const emotes = useRoomEmotes(space);
  const { displayName: myDisplayName } = useOwnProfile();

  const [tab, setTab] = useState<Tab>('hub');
  const [text, setText] = useState('');
  const [privately, setPrivately] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();
  // Account data has no live-update hook in this codebase, and a private post only ever changes
  // in response to something done right here — so this view re-reads on its own actions.
  const [privateRevision, setPrivateRevision] = useState(0);

  const privatePosts = useMemo(
    () => readPrivatePosts(mx, space.roomId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mx, space.roomId, privateRevision]
  );

  const myPosts = useMemo(() => posts.filter((post) => post.sender === myUserId), [posts, myUserId]);

  const nameOf = (userId: string) =>
    members.find((member) => member.userId === userId)?.name ?? userId;
  const avatarOf = (userId: string) =>
    members.find((member) => member.userId === userId)?.getMxcAvatarUrl() ?? null;

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(undefined);
    try {
      if (privately) {
        // Never touches a room at all — that's the whole of what makes it private.
        await savePrivatePost(mx, space.roomId, body);
        setPrivateRevision((n) => n + 1);
        setTab('mine');
      } else {
        const feedRoomId = await ensureFeedRoom(mx, space, myDisplayName || myUserId);
        const { formattedBody } = buildMessageFormatting(body, emotes, []);
        await publishPost(mx, feedRoomId, buildPostContent(body, formattedBody));
      }
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setPosting(false);
    }
  };

  const handleMakePrivate = async (post: FeedPost) => {
    setError(undefined);
    try {
      await makePostPrivate(mx, space.roomId, post.roomId, post.event);
      setPrivateRevision((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to make that post private');
    }
  };

  const handleDeletePost = async (post: FeedPost) => {
    setError(undefined);
    try {
      await deletePost(mx, post.roomId, post.eventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete that post');
    }
  };

  const handlePublishPrivate = async (post: PrivatePost) => {
    setError(undefined);
    try {
      const feedRoomId = await ensureFeedRoom(mx, space, myDisplayName || myUserId);
      const { formattedBody } = buildMessageFormatting(post.body, emotes, []);
      await publishPrivatePost(mx, feedRoomId, post, buildPostContent(post.body, formattedBody));
      setPrivateRevision((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish that post');
    }
  };

  const handleDeletePrivate = async (post: PrivatePost) => {
    setError(undefined);
    try {
      await deletePrivatePost(mx, post.id);
      setPrivateRevision((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete that post');
    }
  };

  const renderPost = (post: FeedPost) => {
    const content = readPost(post.event);
    if (!content) return null;
    const mine = post.sender === myUserId;
    return (
      <article className="nu-post" data-nu-role="feed-post" key={post.eventId}>
        <Avatar name={nameOf(post.sender)} mxcUrl={avatarOf(post.sender)} size={36} />
        <div className="nu-post__body">
          <header className="nu-post__meta">
            <span className="nu-post__author">{nameOf(post.sender)}</span>
            <time className="nu-post__time" dateTime={new Date(post.ts).toISOString()}>
              {formatPostTime(post.ts)}
            </time>
          </header>
          <div className="nu-post__text">{renderMessageText(content.body, emotes, members, myUserId)}</div>
          {mine && (
            <div className="nu-post__actions">
              <button
                type="button"
                className="nu-post__action"
                data-nu-role="feed-post-make-private"
                onClick={() => handleMakePrivate(post)}
              >
                Make private
              </button>
              <button
                type="button"
                className="nu-post__action nu-post__action--danger"
                data-nu-role="feed-post-delete"
                onClick={() => handleDeletePost(post)}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </article>
    );
  };

  const renderPrivatePost = (post: PrivatePost) => (
    <article className="nu-post nu-post--private" data-nu-role="feed-private-post" key={post.id}>
      <Avatar name={myDisplayName || myUserId} mxcUrl={null} size={36} />
      <div className="nu-post__body">
        <header className="nu-post__meta">
          <span className="nu-post__author">{myDisplayName || myUserId}</span>
          <span className="nu-post__badge" data-nu-role="feed-private-badge">
            Only you
          </span>
          <time className="nu-post__time" dateTime={new Date(post.createdAt).toISOString()}>
            {formatPostTime(post.createdAt)}
          </time>
        </header>
        <div className="nu-post__text">{renderMessageText(post.body, emotes, members, myUserId)}</div>
        <div className="nu-post__actions">
          <button
            type="button"
            className="nu-post__action"
            data-nu-role="feed-private-publish"
            onClick={() => handlePublishPrivate(post)}
          >
            Publish
          </button>
          <button
            type="button"
            className="nu-post__action nu-post__action--danger"
            data-nu-role="feed-private-delete"
            onClick={() => handleDeletePrivate(post)}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );

  const shown = tab === 'hub' ? posts : myPosts;
  const empty = shown.length === 0 && (tab === 'hub' || privatePosts.length === 0);

  return (
    <main className="nu-main-pane" data-nu-role="main-pane">
      <div className="nu-main-pane__header" data-nu-role="main-pane-header">
        <button
          type="button"
          className="nu-main-pane__header-back"
          data-nu-role="main-pane-back"
          title="Back to channels"
          onClick={() => setSpaceView(null)}
        >
          ←
        </button>
        <span className="nu-main-pane__header-icon" aria-hidden="true">
          📣
        </span>
        <span className="nu-main-pane__header-name">Posts</span>
        <div className="nu-main-pane__header-actions">
          <button
            type="button"
            className={tab === 'hub' ? 'nu-feed__tab nu-feed__tab--active' : 'nu-feed__tab'}
            data-nu-role="feed-tab-hub"
            onClick={() => setTab('hub')}
          >
            Everyone
          </button>
          <button
            type="button"
            className={tab === 'mine' ? 'nu-feed__tab nu-feed__tab--active' : 'nu-feed__tab'}
            data-nu-role="feed-tab-mine"
            onClick={() => setTab('mine')}
          >
            Yours
          </button>
        </div>
      </div>

      <div className="nu-feed" data-nu-role="feed">
        <form className="nu-feed__composer" onSubmit={handleSubmit} data-nu-role="feed-composer">
          <textarea
            className="nu-feed__input"
            data-nu-role="feed-composer-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Post something to ${space.name}…`}
            rows={3}
          />
          <div className="nu-feed__composer-actions">
            <label className="nu-feed__privacy" data-nu-role="feed-composer-privacy">
              <input type="checkbox" checked={privately} onChange={(e) => setPrivately(e.target.checked)} />
              Only me
            </label>
            <span className="nu-feed__privacy-hint">
              {privately
                ? 'Saved to your account, never sent to a room. Publish it later from Yours.'
                : 'Anyone in this space can read this.'}
            </span>
            <button
              type="submit"
              className="nu-button nu-button--primary"
              data-nu-role="feed-composer-submit"
              disabled={posting || !text.trim()}
            >
              {posting ? 'Posting…' : privately ? 'Save' : 'Post'}
            </button>
          </div>
        </form>

        {error && (
          <p className="nu-field__error" data-nu-role="feed-error">
            {error}
          </p>
        )}

        {tab === 'mine' && privatePosts.map(renderPrivatePost)}
        {shown.map(renderPost)}

        {loading && (
          <p className="nu-feed__status" data-nu-role="feed-loading">
            Catching up on everyone's posts…
          </p>
        )}
        {!loading && empty && (
          <p className="nu-feed__status" data-nu-role="feed-empty">
            {tab === 'hub'
              ? 'Nothing posted here yet. Be the first.'
              : "You haven't posted here yet."}
          </p>
        )}
        {!loading && hasMore && (
          <button
            type="button"
            className="nu-button nu-button--secondary nu-feed__load-more"
            data-nu-role="feed-load-more"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load older posts'}
          </button>
        )}
      </div>
    </main>
  );
}
