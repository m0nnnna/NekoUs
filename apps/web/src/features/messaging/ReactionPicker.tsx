import { useState } from 'react';
import { EmojiPicker } from '../../components/EmojiPicker';
import './ReactionPicker.css';

/**
 * A deliberately small, curated set of common reactions for the one-click row — covers the
 * usual Discord/Slack "quick reaction" range. "More…" opens the full Unicode picker
 * (components/EmojiPicker.tsx) for anything else; custom room emotes aren't reactable yet
 * either way, only plain Unicode emoji.
 */
const QUICK_REACTIONS = ['👍', '👎', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀', '✅', '❌', '🤔'];

/** Hover-revealed "React" trigger + popover — the entry point for adding a *new* reaction type
 *  to a message (toggling an existing one is done directly on its pill, see ReactionBar). */
export function ReactionPicker({ onPick }: { onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const pick = (key: string) => {
    setOpen(false);
    setShowAll(false);
    onPick(key);
  };

  return (
    <div className="nu-reaction-picker">
      <button
        type="button"
        className="nu-timeline__message-pin-action nu-reaction-picker__toggle"
        data-nu-role="reaction-picker-toggle"
        title="Add reaction"
        onClick={() => setOpen((o) => !o)}
      >
        😀+
      </button>
      {open &&
        (showAll ? (
          <div className="nu-reaction-picker__panel nu-reaction-picker__panel--full" data-nu-role="reaction-picker-full-panel">
            <EmojiPicker onPick={pick} />
          </div>
        ) : (
          <div className="nu-reaction-picker__panel" data-nu-role="reaction-picker-panel">
            {QUICK_REACTIONS.map((key) => (
              <button key={key} type="button" className="nu-reaction-picker__item" onClick={() => pick(key)}>
                {key}
              </button>
            ))}
            <button
              type="button"
              className="nu-reaction-picker__more"
              data-nu-role="reaction-picker-more"
              title="More emoji"
              onClick={() => setShowAll(true)}
            >
              …
            </button>
          </div>
        ))}
    </div>
  );
}
