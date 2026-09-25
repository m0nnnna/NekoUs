import { useEffect, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { useSetAtom } from 'jotai';
import { openPostAtom } from '../../app/state/selection';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { buildPostContent, deletePost, editPost, type PostContent, type PostOrigin } from '../../matrix/feed';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import { canModerateFeed, isRemovedFromSpace } from '../../matrix/feedGovernance';
import { useIgnoredUsers } from '../../matrix/hooks/useIgnoredUsers';
import { usePostInteractions } from '../../matrix/hooks/usePostInteractions';
import { CommentThread } from './CommentThread';
import { membersAsPeople } from '../messaging/useMentionAutocomplete';
import { PostCard } from './PostCard';
import { ReportDialog } from './ReportDialog';

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
  const mx = useMatrixClient();
  // Only a feed's owner posts in it, so the post's author is the feed's owner.
  const interactions = usePostInteractions(roomId, postId, card.author.userId, card.ts);
  const setOpenPost = useSetAtom(openPostAtom);
  const onPage = mode === 'page';
  const [open, setOpen] = useState(onPage);
  const [error, setError] = useState<string>();
  const [reporting, setReporting] = useState<{ eventId: string; what: 'post' | 'comment' }>();
  const liked = !!interactions.myLikeId;
  const isPostOwner = card.author.userId === card.myUserId;
  // A Space moderator, mirrored into this feed by its owner (feedGovernance.ts).
  const canModerate = !isPostOwner && canModerateFeed(mx.getRoom(roomId), card.myUserId);
  // Someone who has left or been removed from the Space stops showing here at once, even before
  // the feed's owner comes online and removes them from the feed room itself.
  const space = sourceOrigin.kind === 'space' ? mx.getRoom(sourceOrigin.spaceId) : null;
  const ignored = useIgnoredUsers();
  const comments = interactions.comments.filter(
    (comment) => !isRemovedFromSpace(space, comment.sender) && !ignored.has(comment.sender)
  );
  const commentCount = comments.length > 0 ? `${comments.length}${interactions.older ? '+' : ''}` : '';

  // Editing (the author only). What was saved shows at once, until the feed itself catches up:
  // a post's own page holds a snapshot, and a feed you haven't joined doesn't update live.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [saved, setSaved] = useState<PostContent>();
  useEffect(() => setSaved(undefined), [card.content.body]);
  const content = saved ?? card.content;
  const edited = !!card.edited || !!saved;

  const handleSaveEdit = async (evt: FormEvent) => {
    evt.preventDefault();
    const body = draft.trim();
    if (savingEdit || (!body && !content.attachments?.length && !content.repostOf)) return;
    setSavingEdit(true);
    setError(undefined);
    try {
      const { formattedBody } = buildMessageFormatting(body, card.emotes ?? [], []);
      const next = buildPostContent(body, formattedBody, { attachments: content.attachments, repostOf: content.repostOf });
      await editPost(mx, roomId, postId, next);
      setSaved(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save that edit');
    } finally {
      setSavingEdit(false);
    }
  };

  const editForm = editing ? (
    <form className="nu-post__edit" data-nu-role="post-edit-form" onSubmit={handleSaveEdit}>
      <textarea
        className="nu-field__textarea"
        data-nu-role="post-edit-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        autoFocus
      />
      <div className="nu-form-actions">
        <button type="button" className="nu-button nu-button--secondary" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button type="submit" className="nu-button nu-button--primary" data-nu-role="post-edit-save" disabled={savingEdit}>
          {savingEdit ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  ) : undefined;

  const handleRemove = async () => {
    setError(undefined);
    try {
      await deletePost(mx, roomId, postId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t remove that post');
    }
  };

  const openPage = () =>
    setOpenPost({
      roomId,
      postId,
      isPublic,
      canInteract,
      cannotInteractReason,
      content,
      edited,
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

  // Someone you've blocked: their posts go, wherever they're read from.
  if (ignored.has(card.author.userId)) return null;

  return (
    <PostCard
      {...card}
      content={content}
      edited={edited}
      bodyOverride={editForm}
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
          {isPostOwner && !editing && (
            <button
              type="button"
              className="nu-post__action"
              data-nu-role="post-edit"
              onClick={() => {
                setDraft(content.body);
                setEditing(true);
              }}
            >
              <Icon name="pencil" size={14} />
              Edit
            </button>
          )}
          {extraActions}
          {canModerate && (
            <button
              type="button"
              className="nu-post__action nu-post__action--danger"
              data-nu-role="post-moderator-remove"
              title="Remove this post (moderator)"
              onClick={() => void handleRemove()}
            >
              <Icon name="shield" size={14} />
              Remove
            </button>
          )}
          {!isPostOwner && (
            <button
              type="button"
              className="nu-post__action"
              data-nu-role="post-report"
              title="Report this post"
              aria-label="Report this post"
              onClick={() => setReporting({ eventId: postId, what: 'post' })}
            >
              <Icon name="flag" size={14} />
            </button>
          )}
        </>
      }
      footer={
        <>
          {reporting && (
            <ReportDialog
              roomId={roomId}
              eventId={reporting.eventId}
              what={reporting.what}
              ownerId={card.author.userId}
              onClose={() => setReporting(undefined)}
            />
          )}
          {error && (
            <p className="nu-field__error" data-nu-role="post-interaction-error">
              {error}
            </p>
          )}
          {open && (
            <CommentThread
              comments={comments}
              isPublic={isPublic}
              canComment={canInteract}
              cannotCommentReason={cannotInteractReason}
              canRemoveAny={isPostOwner || canModerate}
              // Only people in the feed room receive its events, so only they can be mentioned.
              mentionPeople={membersAsPeople(mx.getRoom(roomId)?.getJoinedMembers() ?? []).filter(
                (person) => person.userId !== card.myUserId && !ignored.has(person.userId)
              )}
              onReport={(eventId) => setReporting({ eventId, what: 'comment' })}
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
