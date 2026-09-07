import type { ReactionGroup } from '../../matrix/hooks/useReactions';
import './ReactionBar.css';

/** The pill row for a message's existing reactions — click a pill to toggle your own. Adding a
 *  *new* reaction type goes through the hover-revealed "React" button (ReactionPicker) instead,
 *  not through this row. */
export function ReactionBar({
  groups,
  onToggle,
}: {
  groups: ReactionGroup[];
  onToggle: (group: ReactionGroup) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="nu-reaction-bar" data-nu-role="reaction-bar">
      {groups.map((group) => (
        <button
          key={group.key}
          type="button"
          className={group.hasOwnReaction ? 'nu-reaction-pill nu-reaction-pill--own' : 'nu-reaction-pill'}
          data-nu-role="reaction-pill"
          title={group.key}
          onClick={() => onToggle(group)}
        >
          <span className="nu-reaction-pill__key">{group.key}</span>
          <span className="nu-reaction-pill__count">{group.count}</span>
        </button>
      ))}
    </div>
  );
}
