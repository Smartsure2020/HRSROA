import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Vercel native Node ESM dependency chain', () => {
  it('loads the ROA submission snapshot module without Vite resolution', () => {
    expect(() => {
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          "await import('./src/lib/roaSubmissionSnapshot.js')",
        ],
        {
          cwd: process.cwd(),
          stdio: 'pipe',
        },
      );
    }).not.toThrow();
  });
});
