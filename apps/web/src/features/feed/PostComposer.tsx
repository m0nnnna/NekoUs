import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import type { Emote } from '../../matrix/emotes';
import { buildPostContent, savePrivatePost } from '../../matrix/feed';
import type { FeedSource } from '../../matrix/globalFeed';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import { ACCEPTED_MEDIA_TYPES, formatBytes } from '../../matrix/postMedia';
import { publishToTarget, type PostTarget } from '../../matrix/postPublishing';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import { StagedMediaPreviews, useStagedMedia } from './useStagedMedia';
import './PostComposer.css';

export type ComposerTarget = { id: string; label: string; isPublic: boolean; target: PostTarget };

/** Who will be able to read a post sent to this target — shown under the box, always. */
function audienceHint(target: ComposerTarget | undefined, privately: boolean): string {
  if (privately) return 'Saved to your account, never sent to a room. Publish it later from Yours.';
  if (!target) return '';
  if (target.target.kind === 'global') return 'Anyone on this server can read this, on your profile and the global feed.';
  return target.isPublic
    ? `Anyone in ${target.label} can read this, and it appears on the global feed.`
    : `Only members of ${target.label} can read this.`;
}

/**
 * Writing a post: text, up to four images/videos (JPG/PNG shrunk to WebP on the way, see
 * postMedia.ts), and where it goes. `targets` with more than one entry shows a destination
 * picker — the global feed offers Global plus each of your Spaces; a Space's own Posts page has
 * just that Space.
 */
export function PostComposer({
  targets,
  emotes = [],
  placeholder,
  allowPrivate,
  ready = true,
  onPublished,
  onPrivateSaved,
}: {
  targets: ComposerTarget[];
  /** False until it's known which Spaces are public. Posting into a Space waits for it, because
   *  that decides who can read the post and whether its media is encrypted. Global never waits. */
  ready?: boolean;
  emotes?: Emote[];
  placeholder: string;
  /** Offers "Only me" — Space feeds only, since a private post is filed under a Space. */
  allowPrivate?: boolean;
  onPublished?: (source: FeedSource) => void;
  onPrivateSaved?: () => void;
}) {
  const mx = useMatrixClient();
  const { displayName } = useOwnProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [privately, setPrivately] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();
  const media = useStagedMedia(setError);
  const { staged, preparing } = media;

  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const canPrivate = allowPrivate && target?.target.kind === 'space';
  const waitingOnPublicness = !ready && target?.target.kind === 'space';

  useEffect(() => {
    if (!targets.some((t) => t.id === targetId) && targets[0]) setTargetId(targets[0].id);
  }, [targets, targetId]);

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    const body = text.trim();
    if ((!body && staged.length === 0) || posting || preparing || !target || waitingOnPublicness) return;
    setPosting(true);
    setError(undefined);
    try {
      const keepPrivate = privately && canPrivate;
      // Plain uploads only where the post itself is public; everything else is encrypted, so the
      // media is exactly as private as the post it's in (see postMedia.ts).
      const destinationIsPublic = !keepPrivate && (target.target.kind === 'global' || target.isPublic);
      const attachments = await media.upload(!destinationIsPublic);

      if (keepPrivate && target.target.kind === 'space') {
        await savePrivatePost(mx, target.target.space.roomId, body, attachments);
        onPrivateSaved?.();
      } else {
        const { formattedBody } = buildMessageFormatting(body, emotes, []);
        const source = await publishToTarget(
          mx,
          target.target,
          buildPostContent(body, formattedBody, { attachments }),
          displayName || mx.getUserId() || '',
          target.isPublic
        );
        onPublished?.(source);
      }
      setText('');
      media.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t post that');
    } finally {
      setPosting(false);
    }
  };

  const { savedBytes } = media;

  return (
    <form className="nu-post-composer" onSubmit={handleSubmit} data-nu-role="feed-composer">
      <textarea
        className="nu-post-composer__input"
        data-nu-role="feed-composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
      />
      <StagedMediaPreviews staged={staged} onRemove={media.remove} role="feed-composer-previews" />
      <div className="nu-post-composer__bar">
        <button
          type="button"
          className="nu-post-composer__attach"
          data-nu-role="feed-composer-attach"
          title="Add images or video"
          aria-label="Add images or video"
          disabled={media.full || preparing}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="image" size={18} />
        </button>
        <input
          ref={fileInputRef}
          className="nu-post-composer__file"
          type="file"
          accept={ACCEPTED_MEDIA_TYPES}
          multiple
          onChange={media.addFiles}
        />
        {targets.length > 1 && (
          <label className="nu-post-composer__target">
            <span className="nu-post-composer__target-label">Post to</span>
            <select
              className="nu-post-composer__select"
              data-nu-role="feed-composer-target"
              value={target?.id}
              onChange={(e) => {
                setTargetId(e.target.value);
                setPrivately(false);
              }}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.target.kind === 'space' && !t.isPublic ? ' (members only)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {canPrivate && (
          <label className="nu-post-composer__private" data-nu-role="feed-composer-privacy">
            <input type="checkbox" checked={privately} onChange={(e) => setPrivately(e.target.checked)} />
            Only me
          </label>
        )}
        <button
          type="submit"
          className="nu-button nu-button--primary nu-post-composer__submit"
          data-nu-role="feed-composer-submit"
          disabled={posting || preparing || waitingOnPublicness || (!text.trim() && staged.length === 0)}
        >
          {posting ? 'Posting…' : preparing ? 'Preparing…' : privately && canPrivate ? 'Save' : 'Post'}
        </button>
      </div>
      <p className="nu-post-composer__hint" data-nu-role="feed-composer-hint">
        {waitingOnPublicness ? 'Checking who can see posts in this space…' : audienceHint(target, privately && !!canPrivate)}
        {savedBytes > 0 && ` Images converted to WebP, saving ${formatBytes(savedBytes)}.`}
      </p>
      {error && (
        <p className="nu-field__error" data-nu-role="feed-error">
          {error}
        </p>
      )}
    </form>
  );
}
