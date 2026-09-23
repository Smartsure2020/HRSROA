// Service-role Supabase client (Phase ROA-1).
//
// Used by the roa-submissions endpoints for DB inserts, updates and Storage
// upload/download. NEVER shipped to the browser — this file is only imported
// by files under api/, which run only on the server.
//
// Distinct from api/_lib/auth.js which uses the ANON key to call
// supabase.auth.getUser(userToken). That is fine (anon is public); the
// service-role key is not — it bypasses RLS.
//
// Env vars (server-side only):
//   SUPABASE_URL              — same value as VITE_SUPABASE_URL on the client
//   SUPABASE_SERVICE_ROLE_KEY — the project's service-role secret
//
// A missing env var throws so a mis-configured deploy fails fast rather than
// silently falling back to an unauthenticated code path.

import { createClient } from '@supabase/supabase-js';

const ROA_STORAGE_BUCKET = 'roa-pdfs';

let cachedClient = null;

/** Server-side Supabase client with service-role privileges. */
export function getServerSupabase() {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Server Supabase misconfigured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  cachedClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return cachedClient;
}

/** For test isolation only — clears the cached module-scoped client. */
export function _resetServerSupabaseForTests() {
  cachedClient = null;
}

export { ROA_STORAGE_BUCKET };

/** Deterministic, PII-free storage paths for evidence objects. */
export const StoragePaths = Object.freeze({
  canonical: (submissionId) => `${submissionId}/canonical.pdf`,
  signed: (submissionId) => `${submissionId}/signed.pdf`,
  certificate: (submissionId) => `${submissionId}/certificate.pdf`,
  audit: (submissionId) => `${submissionId}/audit.pdf`,
});
