import { useState, type ComponentProps, type ReactNode } from 'react';
import { useSetAtom } from 'jotai';
import { openPostAtom } from '../../app/state/selection';
import { Icon } from '../../components/Icon';
import type { PostOrigin } from '../../matrix/feed';
import { usePostInteractions } from '../../matrix/hooks/usePostInteractions';
import { CommentThread } from './CommentThread';
import { PostCard } from './PostCard';

/** A timeline shows at most this many of a post's newest comments; the rest are on its page. */
export const INLINE_COMMENT_LIMIT = 3;

type InteractivePostProps = Omit<ComponentProps<typeof PostCard>, 'actions' | 'footer'> & {
  /** The feed room the post lives in, and its event ID — where likes and comments go. */
  roomId: string;
  postId: string;
  /** Where the post lives — carried to its own page, and to reposts. */
  sourceOrigin: PostOrigin;
  /** Whether that feed is world-readable (Global, a public Space). Comment media is uploaded
   *  plain there and encrypted everywhere else, matching the post's own media. */
  isPublic: boolean;
  /** Liking and commenting join the feed room, which only works where you're allowed in: any
   *  profile feed, but a Space's feeds only if you're in that Space. */
  canInteract: boolean;
  cannotInteractReason?: string;
  /** Opens the repost dialog; absent when this post can't be reposted anywhere you post. */
  onRepost?: () => void;
  /** Owner-only actions (make private, delete), after the shared ones. */
  extraActions?: ReactNode;
  /** `timeline` (default): the thread opens on demand and shows only the newest few comments,
   *  linking to the post's page for the rest. `page`: the post's own page — the whole thread,
   *  always open. */
  mode?: 'timeline' | 'page';
};

/**
 * A post with its likes, comments and repost — the one card the Space Posts page, the global
 * feed, profiles and a post's own page all render, so they can't drift apart.
 */
export function InteractivePost({
  roomId,
  postId,
  sourceOrigin,
  isPublic,
  canInteract,
  cannotInteractReason,
  onRepost,
  extraActions,
  mode = 'timeline',
  ...card
}: InteractivePostProps) {
  // Only a feed's owner posts in it, so the post's author is the feed's owner.
  const interactions = usePostInteractions(roomId, postId, card.author.userId, card.ts);
  const setOpenPost = useSetAtom(openPostAtom);
  const onPage = mode === 'page';
  const [open, setOpen] = useState(onPage);
  const [error, setError] = useState<string>();
  const liked = !!interactions.myLikeId;
  const isPostOwner = card.author.userId === card.myUserId;
  const commentCount =
    interactions.comments.length > 0 ? `${interactions.comments.length}${interactions.older ? '+' : ''}` : '';

  const openPage = () =>
    setOpenPost({
      roomId,
      postId,
      isPublic,
      canInteract,
      cannotInteractReason,
      content: card.content,
      author: card.author,
      ts: card.ts,
      sourceOrigin,
      showOrigin: !!card.origin,
      emotes: card.emotes,
      members: card.members,
    });

  const handleLike = async () => {
    setError(undefined);
    try {
      await interactions.toggleLike();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t update that like');
    }
  };

  return (
    <PostCard
      {...card}
      actions={
        <>
          <button
            type="button"
            className={liked ? 'nu-post__action nu-post__action--active' : 'nu-post__action'}
            data-nu-role="post-like"
            aria-pressed={liked}
            title={canInteract ? (liked ? 'Unlike' : 'Like') : cannotInteractReason}
            disabled={!canInteract || interactions.busy}
            onClick={() => void handleLike()}
          >
            <Icon name="heart" size={14} filled={liked} />
            {interactions.likeCount > 0 ? `${interactions.likeCount}${interactions.likesTruncated ? '+' : ''}` : 'Like'}
          </button>
          <button
            type="button"
            className={open ? 'nu-post__action nu-post__action--active' : 'nu-post__action'}
            data-nu-role="post-comment-toggle"
            aria-expanded={open}
            // On the post's page the thread is the page; there's nothing to toggle.
            disabled={onPage}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="comment" size={14} />
            {commentCount || 'Comment'}
          </button>
          {onRepost && (
            <button type="button" className="nu-post__action" data-nu-role="post-repost-action" onClick={onRepost}>
              <Icon name="repost" size={14} />
              Repost
            </button>
          )}
          {!onPage && (
            <button type="button" className="nu-post__action" data-nu-role="post-open-page" onClick={openPage}>
              Open
            </button>
          )}
          {extraActions}
        </>
      }
      footer={
        <>
          {error && (
            <p className="nu-field__error" data-nu-role="post-interaction-error">
              {error}
            </p>
          )}
          {open && (
            <CommentThread
              comments={interactions.comments}
              isPublic={isPublic}
              canComment={canInteract}
              cannotCommentReason={cannotInteractReason}
              isPostOwner={isPostOwner}
              emotes={card.emotes}
              members={card.members}
              onAdd={interactions.addComment}
              onDelete={interactions.removeComment}
              hasOlder={!!interactions.older}
              loadingOlder={interactions.loadingOlder}
              onLoadOlder={interactions.loadOlder}
              {...(!onPage && { inlineLimit: INLINE_COMMENT_LIMIT, onViewAll: openPage, totalLabel: commentCount })}
            />
          )}
        </>
      }
    />
  );
}
