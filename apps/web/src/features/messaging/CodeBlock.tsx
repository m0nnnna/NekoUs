import { highlightCode } from './codeHighlight';
import './CodeBlock.css';

/** A ```-fenced block from a message — see renderMessageText.tsx. Renders plain (but still
 *  monospaced) when the language tag is missing or unrecognized, rather than guessing. */
export function CodeBlock({ code, language }: { code: string; language: string }) {
  const highlighted = language ? highlightCode(code, language) : null;

  if (!highlighted) {
    return (
      <pre className="nu-code-block" data-nu-role="code-block">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <pre className="nu-code-block" data-nu-role="code-block">
      <code
        className={`language-${highlighted.language}`}
        // Prism.highlight escapes text it wraps in token spans itself — this is the same
        // trusted-library pattern any Prism-based renderer uses, not raw user HTML.
        dangerouslySetInnerHTML={{ __html: highlighted.html }}
      />
    </pre>
  );
}
