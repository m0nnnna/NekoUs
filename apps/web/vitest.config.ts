/**
 * Deliberately separate from vite.config.ts: that config's plugins (WASM crypto serving, Node
 * globals polyfill for the browser bundle) are for running the real app in a browser, not for
 * running unit tests in Node/jsdom — pulling them into the test config would just add
 * dev-server-only middleware and build-only polyfills that plain `vitest` doesn't need.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
