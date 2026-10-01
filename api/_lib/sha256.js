// SHA-256 of raw bytes (Phase ROA-1).
//
// Server-side helper — never hash the base64 string, always decode to bytes
// first so the persisted hash represents the same PDF payload DocuSign
// receives. Node's crypto module handles this efficiently.

import { createHash } from 'crypto';

/**
 * @param {Uint8Array|Buffer} bytes
 * @returns {string} lowercase hex sha256
 */
export function sha256HexOfBytes(bytes) {
  if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes)) {
    throw new Error('sha256HexOfBytes: expected Uint8Array or Buffer');
  }
  return createHash('sha256').update(bytes).digest('hex');
}

/** Decode a base64 string to a Node Buffer, tolerant of a data-URI prefix. */
export function base64ToBytes(base64) {
  if (typeof base64 !== 'string') throw new Error('base64ToBytes: expected string');
  const stripped = base64.startsWith('data:') ? base64.slice(base64.indexOf(',') + 1) : base64;
  return Buffer.from(stripped, 'base64');
}
