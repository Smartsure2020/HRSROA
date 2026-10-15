import { createClient } from '@supabase/supabase-js';
import { resolveAuthClientConfig } from './authConfig';

// Auth-only client. It points at the HRS CRM Supabase project (brokers' single
// source of identity) and is used for sign-in, session refresh, sign-out and
// password recovery. It is NOT a ROA data client: ROA submissions and evidence are
// reached only through the authenticated /api endpoints.
const config = resolveAuthClientConfig();

if (!config.ok) {
  throw new Error(
    `Authentication is not configured (${config.error}). Set VITE_AUTH_SUPABASE_URL and `
    + 'VITE_AUTH_SUPABASE_ANON_KEY (or the legacy VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
  );
}

export const authProject = Object.freeze({ source: config.source, storageRef: config.storageRef });

export const supabase = createClient(config.url, config.anonKey);
