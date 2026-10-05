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
  },
});
