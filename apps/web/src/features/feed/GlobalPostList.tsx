import { useState } from 'react';
import { useSetAtom } from 'jotai';
import {
  globalFeedOpenAtom,
  profileUserIdAtom,
  selectedRoomIdAtom,
  selectedSpaceIdAtom,
  selectedSpaceViewAtom,
} from '../../app/state/selection';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { deletePost, readPost, repostOfPost, type PostOrigin, type RepostOf } from '../../matrix/feed';
import type { FeedSource, GlobalPost } from '../../matrix/globalFeed';
import { InteractivePost } from './InteractivePost';
import type { ComposerTarget } from './PostComposer';
import { RepostDialog } from './RepostDialog';
import { repostTargetsFor } from './useComposerTargets';

/**
 * A merged list of posts from many feeds — the global feed's timelines and a profile's posts.
 * Every card links its author to their profile and, where you're a member, its Space to that
 * Space's Posts. Anyone can like and comment where they're allowed into the feed room (any
 * profile, or a Space they're in); posts can be reposted by canRepost's rule; your own can be
 * deleted.
 */
export function GlobalPostList({
  posts,
  targets,
  onReposted,
}: {
  posts: GlobalPost[];
  targets: ComposerTarget[];
  onReposted?: (source: FeedSource) => void;
}) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const setProfileUserId = useSetAtom(profileUserIdAtom);
  const setGlobalFeedOpen = useSetAtom(globalFeedOpenAtom);
  const setSelectedSpaceId = useSetAtom(selectedSpaceIdAtom);
  const setSelectedRoomId = useSetAtom(selectedRoomIdAtom);
  const setSpaceView = useSetAtom(selectedSpaceViewAtom);
  const [reposting, setReposting] = useState<{ repostOf: RepostOf; targets: ComposerTarget[] }>();
  const [error, setError] = useState<string>();

  const openSpacePosts = (origin: PostOrigin) => {
    if (origin.kind !== 'space') return;
    setProfileUserId(null);
    setGlobalFeedOpen(false);
    setSelectedSpaceId(origin.spaceId);
    setSelectedRoomId(null);
    setSpaceView('feed');
  };
  const canOpen = (origin: PostOrigin) => origin.kind === 'space' && mx.getRoom(origin.spaceId)?.getMyMembership() === 'join';
  // Liking or commenting joins the post's feed room: any profile feed is open to anyone, but a
  // Space's feeds only let that Space's members in (restricted join rule, feed.ts).
  const canInteractWith = (origin: PostOrigin) => origin.kind === 'global' || canOpen(origin);

  const handleDelete = async (post: GlobalPost) => {
    setError(undefined);
    try {
      await deletePost(mx, post.source.roomId, post.eventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t delete that post');
    }
  };

  return (
    <>
      {error && (
        <p className="nu-field__error" data-nu-role="feed-error">
          {error}
        </p>
      )}
      {posts.map((post) => {
        const content = readPost(post.event);
        if (!content) return null;
        const { source } = post;
        const mine = source.owner === myUserId;
        const repostTargets = repostTargetsFor(targets, source.origin, source.isPublic);
        return (
          <InteractivePost
            key={post.eventId}
            role="global-feed-post"
            roomId={source.roomId}
            postId={post.eventId}
            sourceOrigin={source.origin}
            isPublic={source.isPublic}
            canInteract={canInteractWith(source.origin)}
            cannotInteractReason={
              source.origin.kind === 'space' ? `Join ${source.origin.spaceName} to like or comment.` : undefined
            }
            content={content}
            edited={!!post.event.replacingEventId()}
            author={{ userId: source.owner, name: source.ownerName, avatarUrl: source.ownerAvatarUrl }}
            origin={source.origin}
            ts={post.ts}
            myUserId={myUserId}
            onOpenProfile={setProfileUserId}
            onOpenOrigin={openSpacePosts}
            canOpenOrigin={canOpen}
            onRepost={
              repostTargets.length > 0
                ? () =>
                    setReposting({
                      repostOf: repostOfPost(
                        {
                          roomId: source.roomId,
                          eventId: post.eventId,
                          sender: source.owner,
                          senderName: source.ownerName,
                          origin: source.origin,
                          ts: post.ts,
                        },
                        content
                      ),
                      targets: repostTargets,
                    })
                : undefined
            }
            extraActions={
              mine && (
                <button
                  type="button"
                  className="nu-post__action nu-post__action--danger"
                  data-nu-role="feed-post-delete"
                  onClick={() => handleDelete(post)}
                >
                  <Icon name="trash" size={14} />
                  Delete
                </button>
              )
            }
          />
        );
      })}
      {reposting && (
        <RepostDialog
          repostOf={reposting.repostOf}
          targets={reposting.targets}
          onClose={() => setReposting(undefined)}
          onReposted={onReposted}
        />
      )}
    </>
  );
}
