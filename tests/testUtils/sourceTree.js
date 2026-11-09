// Shared helpers for the static "contract" tests that scan the whole source tree
// (src/ + api/, ~160 files) to prove a safeguard cannot silently disappear.
//
// Those scans are synchronous and I/O bound. Several tests used to re-read and re-strip the
// same files (one test read the tree three times), which is cheap on a Linux CI runner but
// took 5-18 s on a Windows machine with on-access antivirus scanning and tripped Vitest's
// default 5 s timeout. Reading each file once per test file removes the repeated work; the
// explicit timeout below is a safety margin for the one remaining cold pass, applied only to
// the scanning tests rather than raised globally.
//
// The cache lives in module scope, and Vitest gives every test file its own module registry,
// so nothing is shared between test files. Tests never write the files they scan.

import { readFileSync } from 'node:fs';

/** Per-test timeout (ms) for a test that scans the whole source tree or spawns Node. */
export const FS_SCAN_TIMEOUT_MS = 20_000;

const text = new Map();
const code = new Map();

/** File contents, read from disk at most once per test file. */
export function readTextCached(file) {
  const key = String(file);
  if (!text.has(key)) text.set(key, readFileSync(file, 'utf8'));
  return text.get(key);
}

/**
 * File contents without block comments and full-line `//` comments, so prose that merely
 * describes a forbidden pattern cannot trip (or satisfy) a check. Cached like the text.
 */
export function readCodeCached(file) {
  const key = String(file);
  if (!code.has(key)) {
    code.set(key, readTextCached(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''));
  }
  return code.get(key);
}
