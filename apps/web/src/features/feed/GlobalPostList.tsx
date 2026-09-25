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
import { PostCard } from './PostCard';
import type { ComposerTarget } from './PostComposer';
import { RepostDialog } from './RepostDialog';
import { publicTargets } from './useComposerTargets';

/**
 * A merged list of posts from many feeds — the global feed's timelines and a profile's posts.
 * Every card links its author to their profile and, where you're a member, its Space to that
 * Space's Posts. Posts from public places can be reposted; your own can be deleted.
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
  const [reposting, setReposting] = useState<RepostOf>();
  const [error, setError] = useState<string>();
  const repostTargets = publicTargets(targets);

  const openSpacePosts = (origin: PostOrigin) => {
    if (origin.kind !== 'space') return;
    setProfileUserId(null);
    setGlobalFeedOpen(false);
    setSelectedSpaceId(origin.spaceId);
    setSelectedRoomId(null);
    setSpaceView('feed');
  };
  const canOpen = (origin: PostOrigin) => origin.kind === 'space' && mx.getRoom(origin.spaceId)?.getMyMembership() === 'join';

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
        return (
          <PostCard
            key={post.eventId}
            role="global-feed-post"
            content={content}
            author={{ userId: source.owner, name: source.ownerName, avatarUrl: source.ownerAvatarUrl }}
            origin={source.origin}
            ts={post.ts}
            myUserId={myUserId}
            onOpenProfile={setProfileUserId}
            onOpenOrigin={openSpacePosts}
            canOpenOrigin={canOpen}
            actions={
              <>
                {source.isPublic && (
                  <button
                    type="button"
                    className="nu-post__action"
                    data-nu-role="post-repost-action"
                    onClick={() =>
                      setReposting(
                        repostOfPost(
                          {
                            roomId: source.roomId,
                            eventId: post.eventId,
                            sender: source.owner,
                            senderName: source.ownerName,
                            origin: source.origin,
                            ts: post.ts,
                          },
                          content
                        )
                      )
                    }
                  >
                    <Icon name="repost" size={14} />
                    Repost
                  </button>
                )}
                {mine && (
                  <button
                    type="button"
                    className="nu-post__action nu-post__action--danger"
                    data-nu-role="feed-post-delete"
                    onClick={() => handleDelete(post)}
                  >
                    <Icon name="trash" size={14} />
                    Delete
                  </button>
                )}
              </>
            }
          />
        );
      })}
      {reposting && (
        <RepostDialog
          repostOf={reposting}
          targets={repostTargets}
          onClose={() => setReposting(undefined)}
          onReposted={onReposted}
        />
      )}
    </>
  );
}
