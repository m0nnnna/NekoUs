import { useState } from 'react';
import './SpoilerText.css';

/** Discord's `||spoiler||` convention: hidden behind a solid block until clicked. Local
 *  reveal-state only (not synced, not remembered across reloads) — matching how every other
 *  client treats it, purely a per-viewing courtesy, not a security boundary. */
export function SpoilerText({ children }: { children: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={revealed ? 'nu-spoiler nu-spoiler--revealed' : 'nu-spoiler'}
      data-nu-role="spoiler-text"
      onClick={() => setRevealed(true)}
    >
      {children}
    </span>
  );
}
