import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Deliberately narrow: `tsc --noEmit` already covers types, and the test suite covers behaviour,
 * so a stylistic rule set on top of those would mostly generate churn. What's here is the set of
 * rules that catch things neither of the other two can.
 *
 * The react-hooks rules are the reason this exists at all — a missing dependency or a hook
 * called behind a condition typechecks cleanly, passes tests that don't happen to hit the stale
 * render, and then misbehaves in a way that's very hard to trace back. The codebase already had
 * `eslint-disable-next-line react-hooks/exhaustive-deps` comments in it before any linter was
 * configured to read them.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // matrix-js-sdk's custom event types and account-data payloads are typed as narrow unions
      // this codebase can't extend, so every custom `xyz.nekous.*` read/write needs a cast. The
      // casts are deliberate and commented where they matter; flagging every one would train
      // people to stop reading the warnings.
      '@typescript-eslint/no-explicit-any': 'off',

      // An unused function argument is often documenting a callback's real signature (the SDK's
      // timeline listeners take five). Unused *variables* still fail.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    // Tests reach into fakes with shapes the real types don't have, which is the point of a fake.
    files: ['**/*.test.{ts,tsx}', 'src/demo/**'],
    rules: { '@typescript-eslint/no-unsafe-function-type': 'off' },
  }
);
