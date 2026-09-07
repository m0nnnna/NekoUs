import { useMemo, useState } from 'react';
import groups from 'unicode-emoji-json/data-by-group.json';
import './EmojiPicker.css';

type EmojiEntry = { emoji: string; name: string; slug: string };
type EmojiGroup = { name: string; slug: string; emojis: EmojiEntry[] };

const EMOJI_GROUPS = groups as EmojiGroup[];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The full-Unicode-set picker `ReactionPicker`'s quick-reaction row and `Composer`'s emote
 * button both defer to for "anything else" — ~1900 emoji (`unicode-emoji-json`, Unicode's own
 * data, not hand-maintained here) grouped the same way Unicode itself groups them, with a name/
 * slug search across all of them. A shared building block (like Avatar/Modal) rather than
 * living under one feature, since both messaging call sites need the exact same picker.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState('');

  const filteredGroups = useMemo(() => {
    const q = normalize(query);
    if (!q) return EMOJI_GROUPS;
    const matches = EMOJI_GROUPS.flatMap((group) =>
      group.emojis.filter((e) => normalize(e.name).includes(q) || normalize(e.slug).includes(q))
    );
    return matches.length > 0 ? [{ name: 'Search results', slug: 'search-results', emojis: matches }] : [];
  }, [query]);

  return (
    <div className="nu-emoji-picker" data-nu-role="emoji-picker">
      <input
        type="text"
        className="nu-emoji-picker__search"
        data-nu-role="emoji-picker-search"
        placeholder="Search emoji…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="nu-emoji-picker__body" data-nu-role="emoji-picker-body">
        {filteredGroups.length === 0 && <p className="nu-emoji-picker__empty">No emoji found.</p>}
        {filteredGroups.map((group) => (
          <section key={group.slug} className="nu-emoji-picker__group">
            <h3 className="nu-emoji-picker__group-label">{group.name}</h3>
            <div className="nu-emoji-picker__grid">
              {group.emojis.map((e) => (
                <button
                  key={e.slug}
                  type="button"
                  className="nu-emoji-picker__item"
                  data-nu-role="emoji-picker-item"
                  title={e.name}
                  onClick={() => onPick(e.emoji)}
                >
                  {e.emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
