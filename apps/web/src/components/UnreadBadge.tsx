import './UnreadBadge.css';

/** Discord's own convention: a plain dot for "something new happened", a red numbered pill
 *  specifically when a highlight (e.g. an @mention) is among the unread — see
 *  matrix/hooks/useUnreadCounts.ts for where these numbers come from. */
export function UnreadBadge({ total, highlight }: { total: number; highlight: number }) {
  if (highlight > 0) {
    return (
      <span className="nu-unread-badge nu-unread-badge--highlight" data-nu-role="unread-badge-highlight">
        {highlight > 99 ? '99+' : highlight}
      </span>
    );
  }
  if (total > 0) {
    return <span className="nu-unread-badge nu-unread-badge--dot" data-nu-role="unread-badge-dot" aria-hidden="true" />;
  }
  return null;
}
