// Pure checks behind `npm run check:auth-config`. No I/O, no secrets in output.
//
// Verifies the two-project wiring BEFORE a cutover: the AUTH project (HRS CRM) and
// the DATA project (original ROA) are both present, distinct where they should be,
// paired with keys of the right kind, consistent between browser and server, and
// kept apart from the CRM integration secret.

const STATUS = { PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL' };

const read = (env, name) => (typeof env[name] === 'string' ? env[name].trim() : '');

function projectRef(url) {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return null;
  }
}

/** Reads role/ref from a legacy Supabase JWT key WITHOUT verifying it (informational). */
export function describeKey(key) {
  if (!key) return { kind: 'missing' };
  if (/^sb_publishable_/.test(key)) return { kind: 'publishable' };
  if (/^sb_secret_/.test(key)) return { kind: 'secret' };
  const parts = key.split('.');
  if (parts.length !== 3) return { kind: 'unknown' };
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { kind: 'jwt', role: claims.role ?? null, ref: claims.ref ?? null };
  } catch {
    return { kind: 'unknown' };
  }
}

function check(name, status, detail) {
  return { name, status, detail };
}

function pair(env, urlName, keyName) {
  const url = read(env, urlName);
  const key = read(env, keyName);
  if (!url && !key) return { state: 'unset' };
  if (!url || !key) return { state: 'partial', url, key };
  const ref = projectRef(url);
  return ref ? { state: 'set', url, key, ref } : { state: 'invalid', url, key };
}

/**
 * @param {Record<string,string|undefined>} env
 * @param {{ expectedAuthRef?: string, expectedDataRef?: string, requireSplit?: boolean }} [options]
 * @returns {{ checks: Array<{name:string,status:string,detail:string}>, ok: boolean }}
 */
export function evaluateAuthEnvironment(env, options = {}) {
  const { expectedAuthRef, expectedDataRef, requireSplit = true } = options;
  const checks = [];

  const serverAuth = pair(env, 'AUTH_SUPABASE_URL', 'AUTH_SUPABASE_ANON_KEY');
  const browserAuth = pair(env, 'VITE_AUTH_SUPABASE_URL', 'VITE_AUTH_SUPABASE_ANON_KEY');
  // Resolved exactly as api/_lib/authConfig.js does: an explicit ROA_* pair wins; if
  // neither ROA_* variable is set the legacy SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
  // pair IS the data configuration. The approved cutover leaves those legacy
  // variables in place, so requiring ROA_* here would report a false failure.
  const dataExplicit = pair(env, 'ROA_SUPABASE_URL', 'ROA_SUPABASE_SERVICE_ROLE_KEY');
  const dataViaLegacy = dataExplicit.state === 'unset';
  const data = dataViaLegacy ? pair(env, 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY') : dataExplicit;

  // --- completeness -------------------------------------------------------
  for (const [label, p] of [['Server AUTH pair', serverAuth], ['Browser AUTH pair', browserAuth], ['ROA data pair', data]]) {
    if (p.state === 'set') {
      const via = label === 'ROA data pair' && dataViaLegacy ? ' (via legacy SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' : '';
      checks.push(check(label, STATUS.PASS, `project ${p.ref}${via}`));
    }
    else if (p.state === 'unset') {
      checks.push(check(label, STATUS.FAIL, label === 'ROA data pair'
        ? 'neither ROA_SUPABASE_* nor the legacy SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is set'
        : 'not set (legacy single-project fallback would be used)'));
    }
    else if (p.state === 'partial') checks.push(check(label, STATUS.FAIL, 'only one of URL / key is set — refusing to mix projects'));
    else checks.push(check(label, STATUS.FAIL, 'URL is not a valid https Supabase URL'));
  }

  // --- expected projects --------------------------------------------------
  if (expectedAuthRef && serverAuth.state === 'set') {
    checks.push(serverAuth.ref === expectedAuthRef
      ? check('AUTH project is the expected CRM project', STATUS.PASS, expectedAuthRef)
      : check('AUTH project is the expected CRM project', STATUS.FAIL, `expected ${expectedAuthRef}, got ${serverAuth.ref}`));
  }
  if (expectedDataRef && data.state === 'set') {
    checks.push(data.ref === expectedDataRef
      ? check('DATA project is the expected ROA project', STATUS.PASS, expectedDataRef)
      : check('DATA project is the expected ROA project', STATUS.FAIL, `expected ${expectedDataRef}, got ${data.ref}`));
  }

  // --- separation ---------------------------------------------------------
  if (serverAuth.state === 'set' && data.state === 'set') {
    if (serverAuth.ref !== data.ref) {
      checks.push(check('Auth and data are separate projects', STATUS.PASS, `${serverAuth.ref} (auth) ≠ ${data.ref} (data)`));
    } else {
      checks.push(check(
        'Auth and data are separate projects',
        requireSplit ? STATUS.FAIL : STATUS.WARN,
        `both point at ${serverAuth.ref} — this is pre-cutover / rollback mode`,
      ));
    }
  }

  // --- browser/server agreement ------------------------------------------
  if (serverAuth.state === 'set' && browserAuth.state === 'set') {
    checks.push(serverAuth.ref === browserAuth.ref
      ? check('Browser and server use the same AUTH project', STATUS.PASS, serverAuth.ref)
      : check('Browser and server use the same AUTH project', STATUS.FAIL, `server ${serverAuth.ref} vs browser ${browserAuth.ref}`));
    checks.push(serverAuth.key === browserAuth.key
      ? check('Browser and server use the same anon key', STATUS.PASS, 'identical')
      : check('Browser and server use the same anon key', STATUS.FAIL, 'differ'));
  }

  // --- key kinds and pairing ---------------------------------------------
  if (serverAuth.state === 'set') {
    const info = describeKey(serverAuth.key);
    if (info.kind === 'jwt') {
      checks.push(info.role === 'anon'
        ? check('AUTH key is an anon (public) key', STATUS.PASS, 'role=anon')
        : check('AUTH key is an anon (public) key', STATUS.FAIL, `role=${info.role} — a privileged key must never be used for token validation`));
      if (info.ref) {
        checks.push(info.ref === serverAuth.ref
          ? check('AUTH key belongs to the AUTH URL', STATUS.PASS, info.ref)
          : check('AUTH key belongs to the AUTH URL', STATUS.FAIL, `key is for ${info.ref}, URL is ${serverAuth.ref}`));
      }
    } else if (info.kind === 'secret') {
      checks.push(check('AUTH key is an anon (public) key', STATUS.FAIL, 'looks like a secret key'));
    } else {
      checks.push(check('AUTH key is an anon (public) key', STATUS.PASS, `${info.kind} key format`));
    }
  }
  if (data.state === 'set') {
    const info = describeKey(data.key);
    if (info.kind === 'jwt') {
      checks.push(info.role === 'service_role'
        ? check('DATA key is the service-role key', STATUS.PASS, 'role=service_role')
        : check('DATA key is the service-role key', STATUS.FAIL, `role=${info.role}`));
      if (info.ref) {
        checks.push(info.ref === data.ref
          ? check('DATA key belongs to the DATA URL', STATUS.PASS, info.ref)
          : check('DATA key belongs to the DATA URL', STATUS.FAIL, `key is for ${info.ref}, URL is ${data.ref}`));
      }
    } else if (info.kind === 'publishable') {
      checks.push(check('DATA key is the service-role key', STATUS.FAIL, 'looks like a publishable key'));
    }
  }

  // --- secrecy ------------------------------------------------------------
  const leakedNames = Object.keys(env).filter((name) => /^VITE_/.test(name) && /(SERVICE|SECRET|PRIVATE)/i.test(name));
  checks.push(leakedNames.length === 0
    ? check('No privileged key exposed through a VITE_ variable', STATUS.PASS, 'none found')
    : check('No privileged key exposed through a VITE_ variable', STATUS.FAIL, `found: ${leakedNames.join(', ')}`));

  const crmSecret = read(env, 'CRM_INTEGRATION_SECRET');
  if (crmSecret) {
    const reused = ['AUTH_SUPABASE_ANON_KEY', 'ROA_SUPABASE_SERVICE_ROLE_KEY', 'VITE_AUTH_SUPABASE_ANON_KEY']
      .filter((name) => read(env, name) === crmSecret);
    checks.push(reused.length === 0
      ? check('CRM integration secret is distinct from auth/data keys', STATUS.PASS, 'distinct')
      : check('CRM integration secret is distinct from auth/data keys', STATUS.FAIL, `reused as ${reused.join(', ')}`));
  }

  const ok = checks.every((c) => c.status !== STATUS.FAIL);
  return { checks, ok };
}

/**
 * Interprets the public `/auth/v1/settings` response of the AUTH project.
 * Email-based approval is only sound if an email must be CONFIRMED to get a session.
 */
export function evaluateAuthSettings(settings) {
  const checks = [];
  if (!settings || typeof settings !== 'object') {
    return { checks: [check('AUTH project settings readable', STATUS.FAIL, 'no settings returned')], ok: false };
  }
  checks.push(settings.mailer_autoconfirm === false
    ? check('Email confirmation is required (autoconfirm off)', STATUS.PASS, 'a session needs a confirmed mailbox')
    : check('Email confirmation is required (autoconfirm off)', STATUS.FAIL, 'autoconfirm is ON — anyone could register an approved broker\'s address and be treated as them'));
  checks.push(settings.disable_signup === true
    ? check('Public sign-up is disabled', STATUS.PASS, 'invite-only')
    : check('Public sign-up is disabled', STATUS.WARN, 'anyone can create an (unconfirmed) account; recommended to disable and keep invite-only'));
  const ok = checks.every((c) => c.status !== STATUS.FAIL);
  return { checks, ok };
}

export function formatChecks(title, checks) {
  const width = Math.max(...checks.map((c) => c.name.length), 10);
  const lines = checks.map((c) => `  [${c.status}] ${c.name.padEnd(width)}  ${c.detail}`);
  return [title, ...lines].join('\n');
}
