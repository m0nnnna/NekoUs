import { useState, type ChangeEvent } from 'react';
import { getStoredThemeCss, saveThemeCss } from './theme';
import './AppearanceSettings.css';

/** Condensed in-app copy of docs/theming.md's token table — a theme author working from this
 *  panel shouldn't have to go dig up the repo's own docs to know what's overridable. */
const TOKEN_REFERENCE: [string, string][] = [
  ['--nu-color-bg-app', 'Outermost app background (server rail)'],
  ['--nu-color-bg-primary', 'Channel list / member list background'],
  ['--nu-color-bg-secondary', 'Main content pane background'],
  ['--nu-color-bg-tertiary', 'Inputs, recessed surfaces'],
  ['--nu-color-bg-elevated', 'Popovers, menus'],
  ['--nu-color-text-primary / -secondary / -muted', 'Text hierarchy'],
  ['--nu-color-text-link', 'Links'],
  ['--nu-color-accent / -accent-hover', 'Primary action color'],
  ['--nu-color-on-accent', 'Text/icons drawn on the accent/danger/success/warning colors'],
  ['--nu-color-danger / -success / -warning', 'Status colors'],
  ['--nu-color-border', 'Hairline borders/dividers'],
  ['--nu-color-backdrop / -backdrop-strong', 'Modal / image-viewer dimming'],
  ['--nu-space-half … --nu-space-6', 'Spacing scale (2px–32px)'],
  ['--nu-radius-sm / -md / -lg / -full', 'Corner radii'],
  ['--nu-font-body', 'Base font stack'],
  ['--nu-font-size-xs / -sm / -md / -lg', 'Font sizes'],
];

const EXAMPLE_CSS = `:root {\n  --nu-color-accent: #ff5e8a;\n  --nu-color-accent-hover: #e14d76;\n}`;

/**
 * Ready-made starting points, loaded into the editor (not auto-applied — same as "Load from
 * file") so a user can tweak before hitting Apply. Each one only overrides color tokens: every
 * gradient, radius, font, and animation is *derived* from these in tokens.css, so recoloring a
 * handful of variables reskins the whole app without touching shape/motion at all.
 */
const THEME_PRESETS: { name: string; swatch: [string, string]; css: string }[] = [
  {
    name: 'Lola',
    swatch: ['#0a0508', '#ff1f8f'],
    css: `:root {\n  --nu-color-bg-app: #0a0508;\n  --nu-color-bg-primary: #120a10;\n  --nu-color-bg-secondary: #180e15;\n  --nu-color-bg-tertiary: #24141e;\n  --nu-color-bg-elevated: #2e1a27;\n\n  --nu-color-text-primary: #fff3f8;\n  --nu-color-text-secondary: #e2a8c4;\n  --nu-color-text-muted: #8f6577;\n  --nu-color-text-link: #ff7ab8;\n\n  --nu-color-accent: #ff1f8f;\n  --nu-color-accent-hover: #ff4aa8;\n  --nu-color-accent-2: #ff8ec4;\n  --nu-color-accent-2-hover: #ffb3d9;\n  --nu-color-on-accent: #fff3f8;\n\n  --nu-color-danger: #ff2d55;\n  --nu-color-danger-2: #ff5c7a;\n\n  --nu-color-border: #3a1f2c;\n  --nu-color-backdrop: rgba(0, 0, 0, 0.75);\n  --nu-color-backdrop-strong: rgba(0, 0, 0, 0.92);\n}`,
  },
];

/**
 * The "Loading a theme" mechanism docs/theming.md planned ahead of time (Phase 4). Mostly a raw-
 * CSS editor — this is a single-user, self-hosted app, so "write your own :root overrides"
 * covers the real use case without needing to ship and maintain a big preset library. The couple
 * of THEME_PRESETS above are just convenience starting points, explicitly requested, not a
 * general picker system. See app/theme.ts for how the CSS is stored and injected.
 */
export function AppearanceSettings() {
  const [css, setCss] = useState(() => getStoredThemeCss());
  const [justApplied, setJustApplied] = useState(false);

  const handleApply = () => {
    saveThemeCss(css);
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 1500);
  };

  const handleReset = () => {
    setCss('');
    saveThemeCss('');
  };

  const handleFile = (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    evt.target.value = '';
    if (!file) return;
    file.text().then(setCss);
  };

  return (
    <div className="nu-appearance-settings" data-nu-role="appearance-settings">
      <p className="nu-field__hint">
        Override any token below in a <code>:root</code> rule to reskin the app. Applied
        instantly, saved to this browser only (not synced to your account).
      </p>
      <div className="nu-appearance-settings__presets" data-nu-role="appearance-settings-presets">
        {THEME_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="nu-appearance-settings__preset"
            data-nu-role="appearance-settings-preset"
            onClick={() => setCss(preset.css)}
          >
            <span
              className="nu-appearance-settings__preset-swatch"
              style={{
                background: `linear-gradient(135deg, ${preset.swatch[0]}, ${preset.swatch[1]})`,
              }}
              aria-hidden="true"
            />
            {preset.name}
          </button>
        ))}
      </div>
      <textarea
        className="nu-appearance-settings__editor"
        data-nu-role="appearance-settings-editor"
        value={css}
        onChange={(e) => setCss(e.target.value)}
        placeholder={EXAMPLE_CSS}
        spellCheck={false}
        rows={8}
      />
      <div className="nu-appearance-settings__actions">
        <label className="nu-button nu-button--secondary nu-file-picker">
          Load from file
          <input
            type="file"
            accept=".css,text/css"
            data-nu-role="appearance-settings-file-input"
            onChange={handleFile}
          />
        </label>
        <button
          type="button"
          className="nu-button nu-button--secondary"
          data-nu-role="appearance-settings-reset"
          onClick={handleReset}
          disabled={!css}
        >
          Reset to default
        </button>
        <button
          type="button"
          className="nu-button nu-button--primary"
          data-nu-role="appearance-settings-apply"
          onClick={handleApply}
        >
          {justApplied ? 'Applied ✓' : 'Apply'}
        </button>
      </div>
      <details className="nu-appearance-settings__reference">
        <summary>Available tokens</summary>
        <ul className="nu-appearance-settings__reference-list">
          {TOKEN_REFERENCE.map(([token, description]) => (
            <li key={token}>
              <code>{token}</code> — {description}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
