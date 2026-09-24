import { exitDemoMode } from './demoMode';
import './DemoModeBanner.css';

/**
 * Always-visible marker that this isn't a real session. Demo mode fabricates people, messages
 * and a voice deployment convincingly enough that it would otherwise be genuinely unclear
 * whether something on screen came from a homeserver — and a bug report written against demo
 * data would be a waste of everyone's time. It's deliberately not dismissible for that reason.
 */
export function DemoModeBanner() {
  return (
    <div className="nu-demo-banner" data-nu-role="demo-banner">
      <span className="nu-demo-banner__dot" aria-hidden="true" />
      <span className="nu-demo-banner__text">
        <strong>Demo mode</strong> — sample data, no homeserver. Voice stops short of connecting.
      </span>
      <button type="button" className="nu-demo-banner__exit" onClick={exitDemoMode}>
        Leave demo
      </button>
    </div>
  );
}
