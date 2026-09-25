import { useState } from 'react';
import { useSetAtom } from 'jotai';
import { openPostAtom, profileUserIdAtom, type OpenPost } from '../../app/state/selection';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { deletePost, repostOfPost, type RepostOf } from '../../matrix/feed';
import { usePublicSpaceIds } from '../../matrix/hooks/usePublicSpaceIds';
import { InteractivePost } from './InteractivePost';
import { RepostDialog } from './RepostDialog';
import { repostTargetsFor, useComposerTargets } from './useComposerTargets';
import './FeedView.css';

/**
 * One post on its own page, with its whole comment thread — where a timeline's "View all N
 * comments" and "Open" lead. A timeline only ever shows a post's newest few comments, so a thread
 * of any length is read here, a page at a time, instead of stretching every feed it appears in.
 */
export function PostPage({ post }: { post: OpenPost }) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const setOpenPost = useSetAtom(openPostAtom);
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const { ids: publicSpaceIds } = usePublicSpaceIds();
  const targets = useComposerTargets(publicSpaceIds);
  const repostTargets = repostTargetsFor(targets, post.sourceOrigin, post.isPublic);
  const [reposting, setReposting] = useState<RepostOf>();
  const [error, setError] = useState<string>();
  const close = () => setOpenPost(null);
  const mine = post.author.userId === myUserId;

  const handleDelete = async () => {
    setError(undefined);
    try {
      await deletePost(mx, post.roomId, post.postId);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t delete that post');
    }
  };

  return (
    <main className="nu-main-pane" data-nu-role="main-pane">
      <div className="nu-main-pane__header" data-nu-role="main-pane-header">
        <button
          type="button"
          className="nu-main-pane__header-back nu-main-pane__header-back--always"
          data-nu-role="post-page-back"
          title="Back"
          aria-label="Back"
          onClick={close}
        >
          <Icon name="arrowLeft" size={18} />
        </button>
        <Icon name="posts" size={20} className="nu-main-pane__header-icon" />
        <h1 className="nu-main-pane__header-name">Post</h1>
      </div>

      <div className="nu-feed" data-nu-role="post-page">
        {error && (
          <p className="nu-field__error" data-nu-role="feed-error">
            {error}
          </p>
        )}
        <InteractivePost
          mode="page"
          role="post-page-post"
          roomId={post.roomId}
          postId={post.postId}
          sourceOrigin={post.sourceOrigin}
          isPublic={post.isPublic}
          canInteract={post.canInteract}
          cannotInteractReason={post.cannotInteractReason}
          content={post.content}
          author={post.author}
          ts={post.ts}
          origin={post.showOrigin ? post.sourceOrigin : undefined}
          myUserId={myUserId}
          emotes={post.emotes}
          members={post.members}
          onOpenProfile={(userId) => {
            close();
            setProfileUserId(userId);
          }}
          onRepost={
            repostTargets.length > 0
              ? () =>
                  setReposting(
                    repostOfPost(
                      {
                        roomId: post.roomId,
                        eventId: post.postId,
                        sender: post.author.userId,
                        senderName: post.author.name,
                        origin: post.sourceOrigin,
                        ts: post.ts,
                      },
                      post.content
                    )
                  )
              : undefined
          }
          extraActions={
            mine && (
              <button
                type="button"
                className="nu-post__action nu-post__action--danger"
                data-nu-role="feed-post-delete"
                onClick={() => void handleDelete()}
              >
                <Icon name="trash" size={14} />
                Delete
              </button>
            )
          }
        />
      </div>
      {reposting && <RepostDialog repostOf={reposting} targets={repostTargets} onClose={() => setReposting(undefined)} />}
    </main>
  );
}
