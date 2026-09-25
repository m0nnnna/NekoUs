import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import type { Emote } from '../../matrix/emotes';
import { buildPostContent, savePrivatePost } from '../../matrix/feed';
import type { FeedSource } from '../../matrix/globalFeed';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import {
  ACCEPTED_MEDIA_TYPES,
  formatBytes,
  getUploadLimit,
  MAX_ATTACHMENTS,
  prepareMedia,
  uploadPostMedia,
  type PreparedMedia,
} from '../../matrix/postMedia';
import { publishToTarget, type PostTarget } from '../../matrix/postPublishing';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import './PostComposer.css';

export type ComposerTarget = { id: string; label: string; isPublic: boolean; target: PostTarget };

type Staged = PreparedMedia & { previewUrl: string };

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
  const [staged, setStaged] = useState<Staged[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();

  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const canPrivate = allowPrivate && target?.target.kind === 'space';
  const waitingOnPublicness = !ready && target?.target.kind === 'space';

  useEffect(() => {
    if (!targets.some((t) => t.id === targetId) && targets[0]) setTargetId(targets[0].id);
  }, [targets, targetId]);

  // Object URLs hold the file in memory until revoked. Removing one revokes it right there
  // (removeStaged); whatever is still staged when the composer goes away is revoked here.
  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  useEffect(() => () => stagedRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []);

  const handleFiles = async (evt: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(evt.target.files ?? []);
    evt.target.value = '';
    if (!files.length) return;
    setError(undefined);
    const room = MAX_ATTACHMENTS - staged.length;
    if (files.length > room) setError(`A post can have up to ${MAX_ATTACHMENTS} images or videos.`);
    setPreparing(true);
    try {
      const limit = await getUploadLimit(mx);
      const prepared: Staged[] = [];
      for (const file of files.slice(0, room)) {
        try {
          const media = await prepareMedia(file);
          if (limit && media.file.size > limit) {
            setError(`${file.name} is ${formatBytes(media.file.size)}; this server takes up to ${formatBytes(limit)}.`);
            continue;
          }
          prepared.push({ ...media, previewUrl: URL.createObjectURL(media.file) });
        } catch (err) {
          setError(err instanceof Error ? err.message : `${file.name} couldn’t be added.`);
        }
      }
      setStaged((prev) => [...prev, ...prepared]);
    } finally {
      setPreparing(false);
    }
  };

  const removeStaged = (index: number) => {
    setStaged((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

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
      const attachments = [];
      for (const media of staged) attachments.push(await uploadPostMedia(mx, media, { encrypt: !destinationIsPublic }));

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
      staged.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setStaged([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t post that');
    } finally {
      setPosting(false);
    }
  };

  const savedBytes = staged.reduce((sum, item) => sum + (item.originalSize ? item.originalSize - item.file.size : 0), 0);

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
      {staged.length > 0 && (
        <div className="nu-post-composer__previews" data-nu-role="feed-composer-previews">
          {staged.map((item, index) => (
            <div className="nu-post-composer__preview" key={item.previewUrl}>
              {item.kind === 'video' ? (
                <video src={item.previewUrl} muted playsInline />
              ) : (
                <img src={item.previewUrl} alt={item.name} />
              )}
              <span className="nu-post-composer__preview-type">{item.mimetype.split('/')[1].toUpperCase()}</span>
              <button
                type="button"
                className="nu-post-composer__preview-remove"
                aria-label={`Remove ${item.name}`}
                onClick={() => removeStaged(index)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="nu-post-composer__bar">
        <button
          type="button"
          className="nu-post-composer__attach"
          data-nu-role="feed-composer-attach"
          title="Add images or video"
          aria-label="Add images or video"
          disabled={staged.length >= MAX_ATTACHMENTS || preparing}
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
          onChange={handleFiles}
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
