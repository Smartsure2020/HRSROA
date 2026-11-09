import path from 'path';
import { defineConfig } from 'vitest/config';

// Minimal Vitest setup for the Phase 3 operational-reliability test suite.
// Deliberately node-environment (no jsdom/happy-dom) — the lib modules under test are
// plain logic, and tests that need `sessionStorage` provide a small in-memory polyfill
// themselves (see tests/testUtils/memorySessionStorage.js) rather than pulling in a DOM
// dependency for the whole suite.
export default defineConfig({
  // Lets tests import .jsx step components (automatic JSX runtime, as in the Vite build).
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Hermetic browser-auth configuration. src/lib/supabaseClient.js fails closed at import
    // time when the CRM auth project is not configured (that is deliberate, and unchanged), so
    // any suite that imports AuthContext / apiAuth needs these set. They are TEST-ONLY
    // placeholders: a loopback URL (the only plain-http host authConfig accepts) and a
    // non-JWT dummy key. Nothing here is a credential, nothing is reachable, and
    // `createClient()` makes no network call at construction. Vitest applies `test.env` over
    // any developer .env / .env.local, so tests never pick up real project values either.
    // This block lives in vitest.config.js only; vite.config.js (the production build) is
    // untouched, so these values can never reach a bundle.
    env: {
      VITE_AUTH_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_AUTH_SUPABASE_ANON_KEY: 'test-only-placeholder-anon-key',
    },
  },
});
