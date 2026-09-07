import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-ruby';
// prism-php (and any other templating-language component) depends on markup-templating being
// loaded first — without it, highlighting PHP throws instead of just not matching.
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';

/** Common shorthand a message author might type after ``` that Prism's own component names
 *  don't directly recognize (e.g. "js" rather than "javascript"). */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  py: 'python',
  rb: 'ruby',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
};

/**
 * Highlights a fenced code block's content for a declared language tag, entirely client-side —
 * only the handful of languages explicitly imported above are bundled (no Prism autoloader, no
 * fetching a grammar from a CDN, which would leak the tab's IP/timing to a third party on every
 * unfamiliar-looking code block). An unrecognized or empty language tag renders as a plain
 * (still monospaced) block instead of guessing.
 */
export function highlightCode(code: string, language: string): { html: string; language: string } | null {
  const normalized = LANGUAGE_ALIASES[language.toLowerCase()] ?? language.toLowerCase();
  const grammar = Prism.languages[normalized];
  if (!grammar) return null;
  try {
    return { html: Prism.highlight(code, grammar, normalized), language: normalized };
  } catch {
    // A message's fenced-block content is untrusted input from whoever sent it — a grammar bug
    // (e.g. an unusual edge case Prism's tokenizer trips on) must never crash the whole timeline
    // for everyone viewing the room. Fall back to an unhighlighted block instead.
    return null;
  }
}
