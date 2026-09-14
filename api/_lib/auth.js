// Server-side Supabase Auth token verification (Phase ROA-0.1).
//
// ROA-0 verified access tokens locally with HS256 + SUPABASE_JWT_SECRET. That
// works for legacy Supabase projects but couples the endpoints to a specific
// signing model — it will not survive Supabase's future migration to
// asymmetric signing keys, and it duplicates key material into every
// serverless region.
//
// This module instead delegates token validation to the project's Supabase
// Auth service via `supabase.auth.getUser(token)`. Whatever signing model the
// project runs (legacy HS256 or future asymmetric keys), Supabase Auth is the
// authoritative validator. No decoded JWT claim is trusted before the service
// responds.
//
// Environment (server-side only, never exposed to the browser bundle):
//   SUPABASE_URL       — the project's Supabase URL (also visible on the
//                        client as VITE_SUPABASE_URL; identical value).
//   SUPABASE_ANON_KEY  — the anon (publishable) key used to make the
//                        auth.getUser call. Safe to run server-side. Never a
//                        service-role key.
//
// A missing env var returns 500 `server_misconfigured` — never a soft bypass.
// An auth-service error (network / 5xx) also returns 500 so the endpoints
// fail closed rather than allow-listing on infrastructure failure.

import { createClient } from '@supabase/supabase-js';
import { isHrsBrokerEmail } from '../../src/lib/brokerDirectory.js';

export const AUTH_ERROR = Object.freeze({
  MISSING_TOKEN: 'missing_token',
  INVALID_TOKEN: 'invalid_token',
  SERVER_MISCONFIGURED: 'server_misconfigured',
  AUTH_SERVICE_ERROR: 'auth_service_error',
});

function extractBearerToken(req) {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = String(raw).match(/^Bearer\s+([^\s]+)\s*$/);
  return match ? match[1] : null;
}

function getServerSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Verifies the caller's Supabase access token against the project's Auth
 * service and returns the resolved user, or an error code the endpoint can
 * turn into an HTTP status.
 *
 * @param {import('http').IncomingMessage & { headers: Record<string, string> }} req
 * @returns {Promise<{ ok: true, user: { id: string, email: string|null } } | { ok: false, error: string, status: number }>}
 */
export async function authenticate(req) {
  const token = extractBearerToken(req);
  if (!token) {
    return { ok: false, error: AUTH_ERROR.MISSING_TOKEN, status: 401 };
  }

  const supabase = getServerSupabaseClient();
  if (!supabase) {
    return { ok: false, error: AUTH_ERROR.SERVER_MISCONFIGURED, status: 500 };
  }

  let response;
  try {
    response = await supabase.auth.getUser(token);
  } catch {
    // Networking / infrastructure error contacting Supabase Auth. Fail closed.
    return { ok: false, error: AUTH_ERROR.AUTH_SERVICE_ERROR, status: 500 };
  }

  const { data, error } = response || {};
  if (error || !data?.user) {
    return { ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401 };
  }

  return {
    ok: true,
    user: {
      id: typeof data.user.id === 'string' ? data.user.id : '',
      email: typeof data.user.email === 'string' ? data.user.email : null,
    },
  };
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
