import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Same posture as the web app's config: `tsc --noEmit` and the test suite already cover types and
 * behaviour, so this only carries rules neither of those can catch. Narrower than the web app's
 * because there's no React here — no hooks rules to run, which were the main reason that one
 * exists.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', setInterval: 'readonly', fetch: 'readonly' },
    },
    rules: {
      // matrix-js-sdk types custom event types as narrow unions this service can't extend, so the
      // handful of `as any` casts around them are deliberate — see membership.ts and tenancy.ts.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  }
);
