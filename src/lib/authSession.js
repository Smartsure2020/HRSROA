// Browser auth/session helpers. Everything here takes its collaborators
// (window, storage, fetch, supabase client) as arguments so it is unit-testable
// without a DOM.

/** Roa endpoint that confirms an approved ROA broker; see api/roa-submissions/list.js. */
export const BROKER_PROBE_PATH = '/api/roa-submissions/list?view=session';

const HANDOFF_PARAMS = ['access_token', 'refresh_token'];

/**
 * The CRM's "Open ROA System" link carries the broker's session tokens in the
 * query string. Capture them (if present) and remove them from the address bar
 * and history entry IMMEDIATELY, before anything else can read, log or leak the
 * URL. Other query parameters (client_id, policy_id, …) are left untouched.
 *
 * @returns {{ accessToken: string, refreshToken: string } | null}
 */
export function captureHandoffFromUrl(win = globalThis.window) {
  if (!win?.location || !win?.history) return null;

  let params;
  try {
    params = new URLSearchParams(win.location.search);
  } catch {
    return null;
  }
  const hasAny = HANDOFF_PARAMS.some((name) => params.has(name));
  if (!hasAny) return null;

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  for (const name of HANDOFF_PARAMS) params.delete(name);
  const query = params.toString();
  const cleaned = `${win.location.pathname}${query ? `?${query}` : ''}${win.location.hash || ''}`;
  try {
    win.history.replaceState(win.history.state, '', cleaned);
  } catch {
    // If the address bar cannot be rewritten the tokens are still discarded below.
  }

  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

const SUPABASE_STORAGE_KEY = /^sb-([a-z0-9-]+)-auth-token(?:-code-verifier|-user)?$/i;

/**
 * Removes persisted Supabase sessions that belong to a DIFFERENT project than the
 * one ROA now authenticates against — i.e. the stale, pre-cutover ROA-project
 * session — so no old refresh token lingers in the browser. Only keys matching
 * Supabase's own naming are touched; everything else is left alone.
 *
 * @returns {string[]} the keys removed
 */
export function purgeLegacyAuthStorage(storage, activeStorageRef) {
  if (!storage || typeof storage.length !== 'number' || !activeStorageRef) return [];
  const removed = [];
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
    for (const key of keys) {
      const match = typeof key === 'string' ? key.match(SUPABASE_STORAGE_KEY) : null;
      if (match && match[1].toLowerCase() !== activeStorageRef.toLowerCase()) {
        storage.removeItem(key);
        removed.push(key);
      }
    }
  } catch {
    // Storage can be unavailable (private mode / blocked); nothing to clean then.
  }
  return removed;
}

/**
 * Asks the ROA API whether the CRM-issued session belongs to an approved ROA
 * broker. A valid CRM session is necessary but NOT sufficient.
 *
 * @returns {Promise<
 *   { status: 'authorised', broker: { name: string, email: string } } |
 *   { status: 'denied', code: string } |
 *   { status: 'unauthenticated', code: string } |
 *   { status: 'error' }>}
 */
export async function probeBrokerAuthorisation(accessToken, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(BROKER_PROBE_PATH, {
      method: 'GET',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 200 && body?.ok && body?.broker?.email) {
      return { status: 'authorised', broker: { name: body.broker.name || '', email: body.broker.email } };
    }
    if (res.status === 403) return { status: 'denied', code: String(body?.error || 'forbidden') };
    if (res.status === 401) return { status: 'unauthenticated', code: String(body?.error || 'unauthorised') };
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Ends THIS browser's session only. Supabase's default sign-out scope is "global",
 * which would revoke the broker's sessions everywhere — including their CRM login
 * on other devices — because ROA and CRM now share one identity. The revoked
 * session's access token is rejected by the Auth service immediately.
 *
 * If the server could not be reached, supabase-js leaves the session in storage, so
 * it is removed here: the broker must always end up signed out locally.
 *
 * @param {{ auth: { signOut: (options: { scope: 'local' }) => Promise<{ error?: unknown } | undefined> } }} client
 * @param {{ storage?: Pick<Storage, 'removeItem'> | null, storageRef?: string }} [options]
 * @returns {Promise<{ revoked: boolean }>} `revoked` is false when only the local
 *   copy could be cleared (the server-side session then lapses on its own).
 */
export async function signOutLocal(client, options = {}) {
  const { storage, storageRef } = options;
  let failure = null;
  try {
    const result = await client.auth.signOut({ scope: 'local' });
    failure = result?.error || null;
  } catch (error) {
    failure = error;
  }

  if (failure && storage && storageRef) {
    try {
      storage.removeItem(`sb-${storageRef}-auth-token`);
      storage.removeItem(`sb-${storageRef}-auth-token-code-verifier`);
    } catch {
      // Storage unavailable: nothing persisted to remove.
    }
  }
  return { revoked: !failure };
}

/** Notices shown on the sign-in screen after a failed authorisation. */
export const AUTH_NOTICES = Object.freeze({
  denied: 'Your account is signed in to HRS but is not approved for the Record of Advice system. Please contact your administrator.',
  expired: 'Your session has expired. Please sign in again.',
  unverified: 'We could not verify your access just now. Please check your connection and try again.',
});
