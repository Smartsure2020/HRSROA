// Server-side configuration for the two Supabase projects HRS ROA talks to.
//
//   AUTH project  — the HRS CRM Supabase project. Brokers sign in there; ROA only
//                   ever asks it "who owns this access token?". Anon key only.
//   DATA project  — the original ROA Supabase project. Owns roa_submissions, the
//                   private `roa-pdfs` bucket and every audit artefact. Service-role
//                   key only, and only ever used server-side.
//
// The two are configured independently so neither can silently stand in for the
// other:
//
//   AUTH_SUPABASE_URL / AUTH_SUPABASE_ANON_KEY
//   ROA_SUPABASE_URL  / ROA_SUPABASE_SERVICE_ROLE_KEY
//
// Backward compatibility / rollback: when NEITHER variable of a pair is set, that
// side falls back to the legacy single-project names (SUPABASE_URL +
// SUPABASE_ANON_KEY, SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). That is exactly
// the pre-CRM-auth behaviour, so rollback is "unset AUTH_*". A PARTIAL pair
// (one variable of two) is a configuration error and fails closed rather than
// mixing projects.
//
// Values are read on every call (not at import time) so a configuration change
// takes effect without a module reload and tests can vary the environment.

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** Parses a Supabase project URL; https only (http permitted for loopback dev). */
export function parseSupabaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) {
    return null;
  }
  return parsed;
}

function resolvePair({ urlName, keyName, legacyUrlName, legacyKeyName }) {
  const explicitUrl = readEnv(urlName);
  const explicitKey = readEnv(keyName);

  if (explicitUrl || explicitKey) {
    if (!explicitUrl || !explicitKey) return { ok: false, error: 'incomplete', source: 'explicit' };
    return { ok: true, source: 'explicit', url: explicitUrl, key: explicitKey };
  }

  const legacyUrl = readEnv(legacyUrlName);
  const legacyKey = readEnv(legacyKeyName);
  if (!legacyUrl || !legacyKey) return { ok: false, error: 'missing', source: 'legacy' };
  return { ok: true, source: 'legacy', url: legacyUrl, key: legacyKey };
}

/**
 * Where broker access tokens are validated (the CRM Supabase project once cut over).
 *
 * @returns {{ ok: true, source: 'explicit'|'legacy', url: string, anonKey: string, issuer: string, host: string }
 *          | { ok: false, error: string }}
 */
export function getAuthProjectConfig() {
  const pair = resolvePair({
    urlName: 'AUTH_SUPABASE_URL',
    keyName: 'AUTH_SUPABASE_ANON_KEY',
    legacyUrlName: 'SUPABASE_URL',
    legacyKeyName: 'SUPABASE_ANON_KEY',
  });
  if (!pair.ok) return { ok: false, error: `auth_config_${pair.error}` };

  const parsed = parseSupabaseUrl(pair.url);
  if (!parsed) return { ok: false, error: 'auth_config_invalid_url' };

  return {
    ok: true,
    source: pair.source,
    url: parsed.origin,
    anonKey: pair.key,
    // GoTrue stamps `iss` as `<project origin>/auth/v1` on every access token.
    issuer: `${parsed.origin}/auth/v1`,
    host: parsed.hostname,
  };
}

/**
 * Where ROA business data and evidence live (always the original ROA project).
 *
 * @returns {{ ok: true, source: 'explicit'|'legacy', url: string, serviceRoleKey: string, host: string }
 *          | { ok: false, error: string }}
 */
export function getRoaDataConfig() {
  const pair = resolvePair({
    urlName: 'ROA_SUPABASE_URL',
    keyName: 'ROA_SUPABASE_SERVICE_ROLE_KEY',
    legacyUrlName: 'SUPABASE_URL',
    legacyKeyName: 'SUPABASE_SERVICE_ROLE_KEY',
  });
  if (!pair.ok) return { ok: false, error: `roa_data_config_${pair.error}` };

  const parsed = parseSupabaseUrl(pair.url);
  if (!parsed) return { ok: false, error: 'roa_data_config_invalid_url' };

  return {
    ok: true,
    source: pair.source,
    url: parsed.origin,
    serviceRoleKey: pair.key,
    host: parsed.hostname,
  };
}
