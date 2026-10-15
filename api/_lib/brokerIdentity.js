// Broker identity + ownership rules (CRM-auth cutover).
//
// Authentication (who is this?) now comes from the CRM Supabase project, whose
// user ids differ from the ids historic submissions were stamped with. So
// ownership can no longer key on `advisor_user_id`. It keys on the broker's
// verified, normalised email — the same attribute the approved-broker directory
// already uses — compared against the `advisor_email` stored on every row.
//
//   * The email only ever comes from Supabase Auth's own response for a validated
//     token (never from a request body, query string or unverified JWT claim).
//   * It must resolve to exactly one entry in the approved-broker directory.
//   * Rows with a missing / malformed / different advisor_email are NOT owned.
//
// `advisor_user_id` and `advisor_email` are not updatable by the service role
// (column-level grants in 20260914_roa_submissions.sql), so attribution is
// immutable once written. Nothing here rewrites it.

import { BROKER_EMAIL_MAP } from '../../src/lib/brokerDirectory.js';

// Deliberately narrow: no wildcards, quotes, whitespace or unicode. Anything
// outside this shape can never match the directory and never reaches a query.
const SAFE_EMAIL = /^[a-z0-9._+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/**
 * Lower-cases an email and returns it only if it is already a plain ASCII
 * address; otherwise null. Deliberately does NOT trim or otherwise repair its
 * input: an address from Supabase Auth never carries stray whitespace, and an
 * identity comparison should not be forgiving about what it accepts.
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.toLowerCase();
  return SAFE_EMAIL.test(normalized) ? normalized : null;
}

/**
 * Resolves a verified email to exactly one approved broker.
 *
 * @param {unknown} email
 * @param {Record<string,string>} [directory] — injectable for tests
 * @returns {{ ok: true, brokerName: string, brokerEmail: string, normalizedEmail: string }
 *          | { ok: false, reason: 'invalid_email'|'not_in_directory'|'ambiguous_directory' }}
 */
export function resolveBrokerByEmail(email, directory = BROKER_EMAIL_MAP) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { ok: false, reason: 'invalid_email' };

  const matches = Object.entries(directory).filter(
    ([, candidate]) => normalizeEmail(candidate) === normalizedEmail,
  );
  if (matches.length === 0) return { ok: false, reason: 'not_in_directory' };
  // Two directory entries sharing one mailbox would make attribution a guess.
  if (matches.length > 1) return { ok: false, reason: 'ambiguous_directory' };

  const [brokerName, brokerEmail] = matches[0];
  return { ok: true, brokerName, brokerEmail, normalizedEmail };
}

/** True when the stored row belongs to the (already authorised) broker. */
export function ownsSubmission(row, broker) {
  const owner = normalizeEmail(broker?.normalizedEmail);
  if (!owner) return false;
  const rowOwner = normalizeEmail(row?.advisor_email);
  return rowOwner !== null && rowOwner === owner;
}

/** Escapes LIKE/ILIKE metacharacters so an email is matched literally. */
export function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * ILIKE pattern that matches exactly this broker's stored advisor_email,
 * case-insensitively. Throws for an unusable identity so a bad broker object can
 * never degrade into an unfiltered query.
 */
export function ownerEmailPattern(broker) {
  const owner = normalizeEmail(broker?.normalizedEmail);
  if (!owner) throw new Error('invalid_broker_identity');
  return escapeLikePattern(owner);
}
