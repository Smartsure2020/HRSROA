// Browser-side configuration for broker authentication.
//
// Brokers sign in against the HRS CRM Supabase project (AUTH), NOT the ROA data
// project. The browser only ever holds the AUTH project's public anon key; it has
// no ROA database or storage credentials at all — every ROA read/write goes
// through the authenticated /api endpoints.
//
//   VITE_AUTH_SUPABASE_URL / VITE_AUTH_SUPABASE_ANON_KEY   (the CRM project)
//
// Backward compatibility / rollback: when NEITHER is set, the legacy
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY pair is used (the pre-CRM-auth
// behaviour). A partial pair is a configuration error — it must never mix two
// projects. These values are inlined at BUILD time, so changing them needs a new
// deployment.
//
// Service-role keys must never appear in a VITE_* variable (they would ship in the
// bundle); tests/authClientConfig.test.js enforces that.

/**
 * Only the variables auth needs, read by static key so the bundler inlines exactly
 * these and not the whole `import.meta.env` object (which would embed every VITE_*
 * variable in the shipped JavaScript).
 */
function browserEnv() {
  return {
    VITE_AUTH_SUPABASE_URL: import.meta.env.VITE_AUTH_SUPABASE_URL,
    VITE_AUTH_SUPABASE_ANON_KEY: import.meta.env.VITE_AUTH_SUPABASE_ANON_KEY,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_ENABLE_CRM_SESSION_HANDOFF: import.meta.env.VITE_ENABLE_CRM_SESSION_HANDOFF,
  };
}

export function resolveAuthClientConfig(env = browserEnv()) {
  const explicitUrl = String(env?.VITE_AUTH_SUPABASE_URL || '').trim();
  const explicitKey = String(env?.VITE_AUTH_SUPABASE_ANON_KEY || '').trim();

  let source;
  let url;
  let anonKey;
  if (explicitUrl || explicitKey) {
    if (!explicitUrl || !explicitKey) return { ok: false, error: 'auth_config_incomplete' };
    source = 'explicit';
    url = explicitUrl;
    anonKey = explicitKey;
  } else {
    source = 'legacy';
    url = String(env?.VITE_SUPABASE_URL || '').trim();
    anonKey = String(env?.VITE_SUPABASE_ANON_KEY || '').trim();
    if (!url || !anonKey) return { ok: false, error: 'auth_config_missing' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'auth_config_invalid_url' };
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    return { ok: false, error: 'auth_config_invalid_url' };
  }

  return {
    ok: true,
    source,
    url: parsed.origin,
    anonKey,
    // supabase-js keys its localStorage entry on the first DNS label of the URL.
    storageRef: parsed.hostname.split('.')[0],
  };
}

/**
 * CRM → ROA session handoff. The CRM's "Open ROA System" button appends its own
 * access + refresh tokens to the ROA URL. Because ROA now authenticates against
 * the same project, honouring them would sign the broker in automatically — but it
 * also puts a refresh token in a URL and makes ROA and CRM share one refresh-token
 * family (so a refresh in one app can revoke the other's session). It is therefore
 * OFF unless explicitly enabled at build time. Tokens are scrubbed from the URL
 * either way.
 */
export function isCrmSessionHandoffEnabled(env = browserEnv()) {
  return String(env?.VITE_ENABLE_CRM_SESSION_HANDOFF || '').trim().toLowerCase() === 'true';
}
