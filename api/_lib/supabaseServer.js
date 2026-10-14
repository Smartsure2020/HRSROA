// Service-role Supabase client for ROA business data (Phase ROA-1).
//
// Used by the roa-submissions endpoints for DB inserts, updates and Storage
// upload/download. NEVER shipped to the browser — this file is only imported
// by files under api/, which run only on the server.
//
// This client always points at the ROA DATA project (the original ROA Supabase
// project that owns roa_submissions and the private `roa-pdfs` bucket). It is
// deliberately NOT the project brokers authenticate against — see
// ./authConfig.js. The service role bypasses RLS, so every query made through it
// is scoped to the authenticated broker in ./submissionRepo.js.
//
// Env vars (server-side only):
//   ROA_SUPABASE_URL / ROA_SUPABASE_SERVICE_ROLE_KEY
//   (legacy fallback: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
//
// A missing or partial configuration throws so a mis-configured deploy fails fast
// rather than silently falling back to an unauthenticated code path.

import { createClient } from '@supabase/supabase-js';
import { getRoaDataConfig } from './authConfig.js';

const ROA_STORAGE_BUCKET = 'roa-pdfs';

let cachedClient = null;

/** Server-side Supabase client with service-role privileges (ROA data project). */
export function getServerSupabase() {
  if (cachedClient) return cachedClient;
  const config = getRoaDataConfig();
  if (!config.ok) {
    throw new Error(
      `Server Supabase misconfigured (${config.error}): ROA_SUPABASE_URL and ROA_SUPABASE_SERVICE_ROLE_KEY are required `
      + '(or the legacy SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)',
    );
  }
  cachedClient = createClient(config.url, config.serviceRoleKey, {
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
  auditLog: (submissionId) => `${submissionId}/audit-log.pdf`,
});
