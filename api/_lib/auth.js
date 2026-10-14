// Server-side broker authentication (CRM Supabase Auth).
//
// Brokers sign in against the HRS CRM Supabase project. This module decides
// whether a bearer token is a live, CRM-issued broker session and whether the
// person behind it is an approved ROA broker. Those are two separate questions:
//
//   1. AUTHENTICATION — is this a valid access token from the expected Auth
//      project, for a live session? (`authenticate`)
//   2. AUTHORISATION  — is the verified person on the approved-broker list?
//      (`requireAuthenticatedBroker`)
//
// A valid CRM session alone never grants ROA access.
//
// Token validation, in order:
//
//   a. Structural + claim pre-checks on the UNVERIFIED token (`inspectAccessToken`):
//      three base64url segments, a non-`none` algorithm, `iss` equal to the
//      expected project's Auth issuer, `aud=authenticated`, `role=authenticated`,
//      a subject and an unexpired `exp`. These can only REJECT — nothing the
//      token claims is ever trusted to accept it. They exist so a token minted by
//      any other project (notably the old ROA project after cutover) is refused
//      explicitly, without a network call.
//   b. The Supabase Auth service itself (`auth.getUser(token)`) is the sole
//      authority on the signature, the signing key (including rotation: GoTrue
//      holds the current key set) and whether the SESSION still exists, so a
//      signed-out or revoked session is rejected even before `exp`.
//   c. The service-confirmed user must match the token's subject, have a
//      CONFIRMED email, not be anonymous and not be banned.
//
// The service-role key is never used here, and never substitutes for validating a
// user: this module only ever holds the anon key of the AUTH project.
//
// Environment: see ./authConfig.js (AUTH_SUPABASE_URL / AUTH_SUPABASE_ANON_KEY,
// falling back to the legacy SUPABASE_URL / SUPABASE_ANON_KEY).
//
// A missing / partial configuration returns 500 `server_misconfigured`, and an
// auth-service outage returns 500 `auth_service_error` — the endpoints fail
// closed rather than allow-listing on infrastructure failure.

import { createClient } from '@supabase/supabase-js';
import { getAuthProjectConfig } from './authConfig.js';
import { resolveBrokerByEmail } from './brokerIdentity.js';

export const AUTH_ERROR = Object.freeze({
  MISSING_TOKEN: 'missing_token',
  INVALID_TOKEN: 'invalid_token',
  TOKEN_EXPIRED: 'token_expired',
  EMAIL_NOT_CONFIRMED: 'email_not_confirmed',
  USER_BANNED: 'user_banned',
  SERVER_MISCONFIGURED: 'server_misconfigured',
  AUTH_SERVICE_ERROR: 'auth_service_error',
});

const MAX_TOKEN_LENGTH = 16 * 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function extractBearerToken(req) {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = String(raw).match(/^Bearer\s+([^\s]+)\s*$/);
  return match ? match[1] : null;
}

function decodeJsonSegment(segment) {
  if (!BASE64URL.test(segment)) return null;
  try {
    const value = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reject-only inspection of an UNVERIFIED access token. A `{ ok: true }` result
 * means "not obviously wrong", never "valid" — acceptance is the Auth service's
 * decision alone.
 *
 * @param {string} token
 * @param {{ issuer: string }} config
 * @param {number} [nowMs]
 * @returns {{ ok: true, claims: Record<string, unknown> } | { ok: false, reason: string }}
 */
export function inspectAccessToken(token, config, nowMs = Date.now()) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, reason: 'malformed' };
  }
  const header = decodeJsonSegment(parts[0]);
  const claims = decodeJsonSegment(parts[1]);
  if (!header || !claims || !BASE64URL.test(parts[2])) return { ok: false, reason: 'malformed' };

  const alg = typeof header.alg === 'string' ? header.alg : '';
  if (!alg || alg.toLowerCase() === 'none') return { ok: false, reason: 'algorithm' };

  if (claims.iss !== config.issuer) return { ok: false, reason: 'issuer' };

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes('authenticated')) return { ok: false, reason: 'audience' };

  // Excludes the project's anon / service_role keys, which are also JWTs.
  if (claims.role !== 'authenticated') return { ok: false, reason: 'role' };

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    return { ok: false, reason: 'subject' };
  }

  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    return { ok: false, reason: 'malformed' };
  }
  if (claims.exp * 1000 <= nowMs) return { ok: false, reason: 'expired' };

  return { ok: true, claims };
}

function getAuthClient(config) {
  return createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function failure(error, status, reason) {
  return { ok: false, error, status, reason };
}

function isAuthServiceFailure(error) {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  return Number.isFinite(error.status) && error.status >= 500;
}

/**
 * Verifies the caller's access token against the AUTH project and returns the
 * resolved user, or an error code the endpoint can turn into an HTTP status.
 *
 * @param {import('http').IncomingMessage & { headers: Record<string, string> }} req
 * @returns {Promise<{ ok: true, user: { id: string, email: string|null } }
 *   | { ok: false, error: string, status: number, reason: string }>}
 */
export async function authenticate(req) {
  const token = extractBearerToken(req);
  if (!token) return failure(AUTH_ERROR.MISSING_TOKEN, 401, 'missing_token');

  const config = getAuthProjectConfig();
  if (!config.ok) return failure(AUTH_ERROR.SERVER_MISCONFIGURED, 500, config.error);

  const inspected = inspectAccessToken(token, config);
  if (!inspected.ok) {
    return failure(
      inspected.reason === 'expired' ? AUTH_ERROR.TOKEN_EXPIRED : AUTH_ERROR.INVALID_TOKEN,
      401,
      inspected.reason,
    );
  }

  let response;
  try {
    response = await getAuthClient(config).auth.getUser(token);
  } catch {
    // Networking / infrastructure error contacting Supabase Auth. Fail closed.
    return failure(AUTH_ERROR.AUTH_SERVICE_ERROR, 500, 'auth_service_unreachable');
  }

  const { data, error } = response || {};
  if (isAuthServiceFailure(error)) {
    return failure(AUTH_ERROR.AUTH_SERVICE_ERROR, 500, 'auth_service_error');
  }
  const user = data?.user;
  if (error || !user) return failure(AUTH_ERROR.INVALID_TOKEN, 401, 'rejected_by_auth_service');

  // The service answered for this token; make sure it answered for the same
  // subject the token claims, and that it is a real, verified, active person.
  if (typeof user.id !== 'string' || user.id.length === 0 || user.id !== inspected.claims.sub) {
    return failure(AUTH_ERROR.INVALID_TOKEN, 401, 'subject_mismatch');
  }
  if (user.is_anonymous === true) return failure(AUTH_ERROR.INVALID_TOKEN, 401, 'anonymous_user');
  if (!user.email_confirmed_at && !user.confirmed_at) {
    return failure(AUTH_ERROR.EMAIL_NOT_CONFIRMED, 403, 'email_not_confirmed');
  }
  if (user.banned_until && Date.parse(user.banned_until) > Date.now()) {
    return failure(AUTH_ERROR.USER_BANNED, 403, 'user_banned');
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email: typeof user.email === 'string' ? user.email : null,
    },
  };
}

/**
 * Endpoint wrapper: writes the HTTP error and returns null on failure, or returns
 * the authorised broker. A valid session for anyone who is not on the approved
 * list is a 403.
 *
 * @returns {Promise<{ id: string, email: string, normalizedEmail: string,
 *   brokerName: string, brokerEmail: string } | null>}
 */
export async function requireAuthenticatedBroker(req, res) {
  const result = await authenticate(req);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }

  const broker = resolveBrokerByEmail(result.user.email);
  if (!broker.ok) {
    res.status(403).json({
      error: broker.reason === 'ambiguous_directory' ? 'broker_identity_ambiguous' : 'not_an_hrs_broker',
    });
    return null;
  }

  return {
    id: result.user.id,
    email: result.user.email,
    normalizedEmail: broker.normalizedEmail,
    brokerName: broker.brokerName,
    brokerEmail: broker.brokerEmail,
  };
}
