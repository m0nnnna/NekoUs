import { useState } from 'react';
import { JoinRule, type Room } from 'matrix-js-sdk';
import { buildInviteLink } from '../../matrix/inviteLinks';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { getJoinRule, setJoinRule } from '../../matrix/roomCreation';

/**
 * Lets an admin turn a Space into "anyone with the link joins instantly" (join_rule: public)
 * without also publishing it to the Discover directory — those are two separate Matrix knobs
 * (see roomCreation.ts's createRoom comment for the same distinction at creation time). There's
 * no separate secret/expiring invite token: the link just encodes the room ID, so "revoking" it
 * means toggling this back off, which invalidates every copy at once.
 */
export function SpaceInviteLinkSettings({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const [joinRule, setJoinRuleState] = useState(getJoinRule(space));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const enabled = joinRule === JoinRule.Public;
  const link = buildInviteLink(space.roomId, mx.getUserId()?.split(':')[1] ?? '');

  const handleToggle = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    const nextRule = enabled ? JoinRule.Invite : JoinRule.Public;
    try {
      await setJoinRule(mx, space.roomId, nextRule);
      setJoinRuleState(nextRule);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the invite link');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="nu-modal-form" data-nu-role="space-invite-link-settings">
      <label className="nu-field__checkbox-row">
        <input type="checkbox" checked={enabled} onChange={handleToggle} disabled={submitting} />
        Public join link
      </label>
      <p className="nu-space-invite-link__note">
        When on, anyone with the link below joins this Space instantly — no invite needed. The
        Space is <strong>not</strong> listed in the public Discover directory just from this — that's
        the Public space setting above. Turning this back off invalidates the link for anyone who still
        has a copy of it.
      </p>
      {enabled && (
        <label className="nu-field">
          Invite link
          <div className="nu-space-invite-link__row">
            <input
              className="nu-field__input"
              value={link}
              readOnly
              data-nu-role="space-invite-link-input"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="nu-button nu-button--secondary"
              data-nu-role="space-invite-link-copy"
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </label>
      )}
      {error && (
        <p className="nu-field__error" data-nu-role="space-invite-link-error">
          {error}
        </p>
      )}
    </div>
  );
}
