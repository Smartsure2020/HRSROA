// Server-side Supabase JWT verification (Phase ROA-0).
//
// The two action endpoints — /api/send-email and /api/send-for-signature — were
// previously open POSTs. This helper verifies the caller's Supabase access token
// (issued by the existing frontend auth flow, see src/lib/supabaseClient.js and
// AuthContext.jsx) using the project's HS256 JWT secret. There is only one
// authentication system — this file is the server-side half of it.
//
// The frontend passes the token as `Authorization: Bearer <access_token>`. It is
// the same JWT that already fronts crm.hrsinsurance.co.za calls (see
// src/lib/useCrmSyncStatus.js). No new credential is introduced here.
//
// Environment:
//   SUPABASE_JWT_SECRET — required. The HS256 signing secret from the Supabase
//                         project's API settings. Never exposed to the browser.
//
// A missing secret is treated as a server misconfiguration (500), not a soft
// bypass, so an unauthenticated fallback path cannot exist by accident.

import { jwtVerify } from 'jose';
import { isHrsBrokerEmail } from '../../src/lib/brokerDirectory.js';

/** Result codes returned by `authenticate` so callers can shape the HTTP response. */
export const AUTH_ERROR = Object.freeze({
  MISSING_TOKEN: 'missing_token',
  INVALID_TOKEN: 'invalid_token',
  SERVER_MISCONFIGURED: 'server_misconfigured',
});

function extractBearerToken(req) {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = String(raw).match(/^Bearer\s+([^\s]+)\s*$/);
  return match ? match[1] : null;
}

/**
 * Verifies the caller's Supabase access token and returns the resolved user, or
 * an error code the endpoint can turn into an HTTP status.
 *
 * @param {import('http').IncomingMessage & { headers: Record<string, string> }} req
 * @returns {Promise<{ ok: true, user: { id: string, email: string|null } } | { ok: false, error: string, status: number }>}
 */
export async function authenticate(req) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return { ok: false, error: AUTH_ERROR.SERVER_MISCONFIGURED, status: 500 };
  }

  const token = extractBearerToken(req);
  if (!token) {
    return { ok: false, error: AUTH_ERROR.MISSING_TOKEN, status: 401 };
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      audience: 'authenticated',
    });
    return {
      ok: true,
      user: {
        id: typeof payload.sub === 'string' ? payload.sub : '',
        email: typeof payload.email === 'string' ? payload.email : null,
      },
    };
  } catch {
    return { ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401 };
  }
}

/**
 * Convenience wrapper for endpoints — writes the response and returns null on
 * failure, or returns the resolved user on success.
 */
export async function requireAuthenticatedBroker(req, res) {
  const result = await authenticate(req);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  if (!result.user.email || !isHrsBrokerEmail(result.user.email)) {
    res.status(403).json({ error: 'not_an_hrs_broker' });
    return null;
  }
  return result.user;
}
