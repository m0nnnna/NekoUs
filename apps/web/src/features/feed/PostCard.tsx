import type { ReactNode } from 'react';
import type { RoomMember } from 'matrix-js-sdk';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import type { Emote } from '../../matrix/emotes';
import type { PostContent, PostOrigin } from '../../matrix/feed';
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
  onOpenProfile?: (userId: string) => void;
  /** Opens a Space's posts from its chip. Only Spaces you're in can be opened (see
   *  canOpenOrigin); a Global chip is never a link, since the author's name already is. */
  onOpenOrigin?: (origin: PostOrigin) => void;
  canOpenOrigin?: (origin: PostOrigin) => boolean;
  actions?: ReactNode;
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
  onOpenProfile,
  onOpenOrigin,
  canOpenOrigin,
  actions,
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
        </header>
        {content.body && <div className="nu-post__text">{renderMessageText(content.body, emotes, members, myUserId)}</div>}
        {content.attachments && <PostMedia attachments={content.attachments} />}
        {repost && (
          <blockquote className="nu-post__quote" data-nu-role="post-repost">
            <header className="nu-post__meta">
              <AuthorName
                author={{ userId: repost.sender, name: repost.senderName }}
                onOpenProfile={onOpenProfile}
              />
              <OriginChip origin={repost.origin} onOpen={openerFor(repost.origin)} />
              {repost.ts > 0 && <time className="nu-post__time">{formatPostTime(repost.ts)}</time>}
            </header>
            {repost.body && <div className="nu-post__text">{renderMessageText(repost.body, [], [], myUserId)}</div>}
            {repost.attachments && <PostMedia attachments={repost.attachments} />}
          </blockquote>
        )}
        {actions && <div className="nu-post__actions">{actions}</div>}
      </div>
    </article>
  );
}
