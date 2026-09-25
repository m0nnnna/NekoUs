import { useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { buildPostContent, type RepostOf } from '../../matrix/feed';
import type { FeedSource } from '../../matrix/globalFeed';
import { buildMessageFormatting } from '../../matrix/messageFormatting';
import { publishToTarget } from '../../matrix/postPublishing';
import { useOwnProfile } from '../../matrix/hooks/useOwnProfile';
import type { ComposerTarget } from './PostComposer';
import { PostCard } from './PostCard';

/**
 * Repost with an optional comment. The caller passes only the targets canRepost allows for this
 * post (repostTargetsFor): public places for a public post, or the same Space for a post from a
 * private one — so a repost never carries content somewhere more visible than it already was.
 */
export function RepostDialog({
  repostOf,
  targets,
  onClose,
  onReposted,
}: {
  repostOf: RepostOf;
  /** Already narrowed to public targets by the caller. */
  targets: ComposerTarget[];
  onClose: () => void;
  onReposted?: (source: FeedSource) => void;
}) {
  const mx = useMatrixClient();
  const myUserId = mx.getUserId() ?? '';
  const { displayName } = useOwnProfile();
  const [targetId, setTargetId] = useState(targets[0]?.id ?? '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const target = targets.find((t) => t.id === targetId);

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const body = comment.trim();
      const { formattedBody } = buildMessageFormatting(body, [], []);
      const source = await publishToTarget(
        mx,
        target.target,
        buildPostContent(body, formattedBody, { repostOf }),
        displayName || myUserId,
        target.isPublic
      );
      onReposted?.(source);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t repost that');
      setBusy(false);
    }
  };

  return (
    <Modal title="Repost" onClose={onClose} wide>
      <form className="nu-modal-form" onSubmit={handleSubmit} data-nu-role="repost-dialog">
        <label className="nu-field">
          Repost to
          <select
            className="nu-field__input"
            data-nu-role="repost-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="nu-field">
          Add a comment (optional)
          <textarea
            className="nu-field__textarea"
            data-nu-role="repost-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
          />
        </label>
        <PostCard
          content={{ body: repostOf.body, ...(repostOf.attachments && { attachments: repostOf.attachments }) }}
          author={{ userId: repostOf.sender, name: repostOf.senderName }}
          origin={repostOf.origin}
          ts={repostOf.ts}
          myUserId={myUserId}
          role="repost-preview"
        />
        {error && <p className="nu-field__error">{error}</p>}
        <div className="nu-form-actions">
          <button type="button" className="nu-button nu-button--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="nu-button nu-button--primary" data-nu-role="repost-submit" disabled={busy || !target}>
            {busy ? 'Reposting…' : 'Repost'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
