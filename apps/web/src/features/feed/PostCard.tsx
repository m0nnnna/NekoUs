import type { ReactNode } from 'react';
import type { RoomMember } from 'matrix-js-sdk';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import type { Emote } from '../../matrix/emotes';
import type { PostContent, PostOrigin, RepostOf } from '../../matrix/feed';
import { useIgnoredUsers } from '../../matrix/hooks/useIgnoredUsers';
import { useRepostStatus } from '../../matrix/hooks/useRepostStatus';
import { renderMessageText } from '../messaging/renderMessageText';
import { formatPostTime } from './formatPostTime';
import { PostMedia } from './PostMedia';

export type PostAuthor = { userId: string; name: string; avatarUrl?: string | null };

type PostCardProps = {
  content: PostContent;
  author: PostAuthor;
  ts: number;
  /** Where the post lives — shown as a chip when the timeline mixes places. */
  origin?: PostOrigin;
  myUserId: string;
  emotes?: Emote[];
  members?: RoomMember[];
  privateBadge?: boolean;
  /** The author has edited it since posting. */
  edited?: boolean;
  /** Shown in place of the text — the edit box, while the author is editing. */
  bodyOverride?: ReactNode;
  onOpenProfile?: (userId: string) => void;
  /** Opens a Space's posts from its chip. Only Spaces you're in can be opened (see
   *  canOpenOrigin); a Global chip is never a link, since the author's name already is. */
  onOpenOrigin?: (origin: PostOrigin) => void;
  canOpenOrigin?: (origin: PostOrigin) => boolean;
  actions?: ReactNode;
  /** Below the action row — the comment thread, when it's open. */
  footer?: ReactNode;
  role?: string;
};

function OriginChip({ origin, onOpen }: { origin: PostOrigin; onOpen?: (origin: PostOrigin) => void }) {
  const label = origin.kind === 'global' ? 'Global' : origin.spaceName;
  const className = origin.kind === 'global' ? 'nu-post__origin nu-post__origin--global' : 'nu-post__origin';
  if (!onOpen) {
    return (
      <span className={`${className} nu-post__origin--static`} data-nu-role="post-origin">
        {origin.kind === 'global' && <Icon name="globe" size={11} />}
        {label}
      </span>
    );
  }
  return (
    <button type="button" className={className} data-nu-role="post-origin" title={`Open ${label}`} onClick={() => onOpen(origin)}>
      {origin.kind === 'global' && <Icon name="globe" size={11} />}
      {label}
    </button>
  );
}

function AuthorName({ author, onOpenProfile }: { author: PostAuthor; onOpenProfile?: (userId: string) => void }) {
  if (!onOpenProfile) return <span className="nu-post__author">{author.name}</span>;
  return (
    <button type="button" className="nu-post__author nu-post__author--link" data-nu-role="post-author" onClick={() => onOpenProfile(author.userId)}>
      {author.name}
    </button>
  );
}

/**
 * The original inside a repost. The copy travels with the repost, so it's checked against the real
 * post (matrix/repostCheck.ts): a deleted original shows as removed, and a copy that doesn't match
 * isn't shown at all. Until the check answers, and when it can't, the copy shows.
 */
function RepostQuote({
  repost,
  myUserId,
  onOpenProfile,
  openerFor,
}: {
  repost: RepostOf;
  myUserId: string;
  onOpenProfile?: (userId: string) => void;
  openerFor: (target: PostOrigin) => ((origin: PostOrigin) => void) | undefined;
}) {
  const status = useRepostStatus(repost);
  const ignored = useIgnoredUsers();
  if (ignored.has(repost.sender)) {
    return (
      <blockquote className="nu-post__quote nu-post__quote--unavailable" data-nu-role="post-repost-unavailable">
        A post by someone you’ve blocked.
      </blockquote>
    );
  }
  if (status === 'deleted' || status === 'mismatch') {
    return (
      <blockquote className="nu-post__quote nu-post__quote--unavailable" data-nu-role="post-repost-unavailable">
        {status === 'deleted'
          ? 'This post was removed.'
          : 'This repost doesn’t match the original post, so it isn’t shown.'}
      </blockquote>
    );
  }
  return (
    <blockquote className="nu-post__quote" data-nu-role="post-repost">
      <header className="nu-post__meta">
        <AuthorName author={{ userId: repost.sender, name: repost.senderName }} onOpenProfile={onOpenProfile} />
        <OriginChip origin={repost.origin} onOpen={openerFor(repost.origin)} />
        {repost.ts > 0 && <time className="nu-post__time">{formatPostTime(repost.ts)}</time>}
        {status === 'unknown' && (
          <span className="nu-post__badge" data-nu-role="post-repost-unchecked" title="Couldn’t reach the original to check this copy">
            Unchecked
          </span>
        )}
      </header>
      {repost.body && <div className="nu-post__text">{renderMessageText(repost.body, [], [], myUserId)}</div>}
      {repost.attachments && <PostMedia attachments={repost.attachments} />}
    </blockquote>
  );
}

/**
 * One post: author, where it lives, text, media — and for a repost, the original embedded in a
 * quoted card, readable here even if its own room isn't (the content travels with the repost).
 */
export function PostCard({
  content,
  author,
  ts,
  origin,
  myUserId,
  emotes = [],
  members = [],
  privateBadge,
  edited,
  bodyOverride,
  onOpenProfile,
  onOpenOrigin,
  canOpenOrigin,
  actions,
  footer,
  role = 'feed-post',
}: PostCardProps) {
  const repost = content.repostOf;
  const openerFor = (target: PostOrigin) =>
    onOpenOrigin && target.kind === 'space' && (canOpenOrigin?.(target) ?? true) ? onOpenOrigin : undefined;

  return (
    <article className={privateBadge ? 'nu-post nu-post--private' : 'nu-post'} data-nu-role={role}>
      <Avatar name={author.name} mxcUrl={author.avatarUrl ?? null} size={40} />
      <div className="nu-post__body">
        {repost && (
          <div className="nu-post__repost-label" data-nu-role="post-repost-label">
            <Icon name="repost" size={13} />
            Reposted
          </div>
        )}
        <header className="nu-post__meta">
          <AuthorName author={author} onOpenProfile={onOpenProfile} />
          {origin && <OriginChip origin={origin} onOpen={openerFor(origin)} />}
          {privateBadge && (
            <span className="nu-post__badge" data-nu-role="feed-private-badge">
              Only you
            </span>
          )}
          <time className="nu-post__time" dateTime={new Date(ts).toISOString()} title={new Date(ts).toLocaleString()}>
            {formatPostTime(ts)}
          </time>
          {edited && (
            <span className="nu-post__time" data-nu-role="post-edited">
              (edited)
            </span>
          )}
        </header>
        {bodyOverride ??
          (content.body && <div className="nu-post__text">{renderMessageText(content.body, emotes, members, myUserId)}</div>)}
        {content.attachments && <PostMedia attachments={content.attachments} />}
        {repost && <RepostQuote repost={repost} myUserId={myUserId} onOpenProfile={onOpenProfile} openerFor={openerFor} />}
        {actions && <div className="nu-post__actions">{actions}</div>}
        {footer}
      </div>
    </article>
  );
}
