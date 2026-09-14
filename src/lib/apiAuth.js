// Small helper for browser-side calls to authenticated HRS action endpoints
// (Phase ROA-0). Returns the current Supabase access token, or throws if the
// user isn't signed in — the endpoints now enforce a 401 without it, so
// failing fast in the browser is clearer than surfacing an auth error from the
// server.
import { supabase } from './supabaseClient';

/**
 * @returns {Promise<string>} Supabase access token for the current user.
 * @throws  if no session exists.
 */
export async function getAccessTokenOrThrow() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error('Could not read authentication session.');
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in.');
  return token;
}

/** Convenience — returns an `Authorization: Bearer …` header for fetch. */
export async function authHeader() {
  const token = await getAccessTokenOrThrow();
  return { Authorization: `Bearer ${token}` };
}
