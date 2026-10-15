// CRM Supabase Auth integration — authentication + authorisation contract.
//
// Brokers authenticate against the HRS CRM Supabase project; ROA only validates
// those sessions and decides separately whether the person is an approved broker.
// Everything here runs offline: `@supabase/supabase-js` is mocked, so the Auth
// service's verdicts are scripted, and the real thing under test is what ROA does
// with them (config resolution, claim pre-checks, subject binding, email
// verification, directory authorisation).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestJwt } from './testUtils/testJwt.js';

const CRM_URL = 'https://mgqelduyralkdbsbwqcu.supabase.co';
const ROA_URL = 'https://rylfshngbafldisqrhec.supabase.co';
const CRM_ISSUER = `${CRM_URL}/auth/v1`;
const ROA_ISSUER = `${ROA_URL}/auth/v1`;
const SERVICE_KEY = 'roa-service-role-secret';

// Scripted Auth-service verdicts + a record of how clients were constructed.
const getUserQueue = [];
const getUserCalls = [];
const clientCalls = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((url, key, options) => {
    clientCalls.push({ url, key, options });
    return {
      auth: {
        getUser: vi.fn(async (token) => {
          getUserCalls.push({ url, key, token });
          const next = getUserQueue.shift();
          if (typeof next === 'function') return next();
          if (next && typeof next.throw === 'string') throw new Error(next.throw);
          return next ?? { data: { user: null }, error: { message: 'no verdict queued' } };
        }),
      },
    };
  }),
}));

const { AUTH_ERROR, authenticate, inspectAccessToken, requireAuthenticatedBroker } = await import('../api/_lib/auth.js');
const { getAuthProjectConfig, getRoaDataConfig } = await import('../api/_lib/authConfig.js');
const { getServerSupabase, _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { normalizeEmail, resolveBrokerByEmail } = await import('../api/_lib/brokerIdentity.js');
const { BROKER_EMAIL_MAP } = await import('../src/lib/brokerDirectory.js');
const listHandler = (await import('../api/roa-submissions/list.js')).default;

const ENV_KEYS = [
  'AUTH_SUPABASE_URL', 'AUTH_SUPABASE_ANON_KEY', 'ROA_SUPABASE_URL', 'ROA_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
];
const savedEnv = {};

function setCutoverEnv() {
  process.env.AUTH_SUPABASE_URL = CRM_URL;
  process.env.AUTH_SUPABASE_ANON_KEY = 'crm-anon-key';
  process.env.ROA_SUPABASE_URL = ROA_URL;
  process.env.ROA_SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  // The legacy single-project variables still point at ROA until validated.
  process.env.SUPABASE_URL = ROA_URL;
  process.env.SUPABASE_ANON_KEY = 'roa-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
}

function crmToken(overrides = {}) {
  return makeTestJwt({ sub: 'crm-user-1', iss: CRM_ISSUER, ...overrides });
}
const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });

function authVerdict(overrides = {}) {
  return {
    data: {
      user: {
        id: 'crm-user-1',
        email: 'andrew@hrsinsurance.co.za',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
      },
    },
    error: null,
  };
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  setCutoverEnv();
  getUserQueue.length = 0;
  getUserCalls.length = 0;
  clientCalls.length = 0;
  _resetServerSupabaseForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('auth / data project separation', () => {
  it('validates tokens against the AUTH (CRM) project with its anon key only', async () => {
    getUserQueue.push(authVerdict());
    const result = await authenticate(bearer(crmToken()));

    expect(result.ok).toBe(true);
    expect(getUserCalls).toHaveLength(1);
    expect(getUserCalls[0].url).toBe(CRM_URL);
    expect(getUserCalls[0].key).toBe('crm-anon-key');
    // The ROA service-role key is never used to identify a user.
    expect(clientCalls.map((c) => c.key)).not.toContain(SERVICE_KEY);
    // The validating client holds no session of its own.
    expect(clientCalls[0].options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
  });

  it('points the data client at the ROA project, never at the auth project', () => {
    getServerSupabase();
    expect(clientCalls).toHaveLength(1);
    expect(clientCalls[0].url).toBe(ROA_URL);
    expect(clientCalls[0].key).toBe(SERVICE_KEY);
    expect(clientCalls[0].url).not.toBe(CRM_URL);
  });

  it('resolves the two projects independently and exposes the expected issuer', () => {
    expect(getAuthProjectConfig()).toMatchObject({
      ok: true, source: 'explicit', url: CRM_URL, issuer: CRM_ISSUER, anonKey: 'crm-anon-key',
    });
    expect(getRoaDataConfig()).toMatchObject({
      ok: true, source: 'explicit', url: ROA_URL, serviceRoleKey: SERVICE_KEY,
    });
  });

  it('falls back to the legacy single-project variables when AUTH_* is unset (rollback path)', () => {
    delete process.env.AUTH_SUPABASE_URL;
    delete process.env.AUTH_SUPABASE_ANON_KEY;
    delete process.env.ROA_SUPABASE_URL;
    delete process.env.ROA_SUPABASE_SERVICE_ROLE_KEY;

    expect(getAuthProjectConfig()).toMatchObject({ ok: true, source: 'legacy', url: ROA_URL, issuer: ROA_ISSUER });
    expect(getRoaDataConfig()).toMatchObject({ ok: true, source: 'legacy', url: ROA_URL });
  });

  it('fails closed on a partial AUTH pair instead of mixing projects', async () => {
    delete process.env.AUTH_SUPABASE_ANON_KEY;
    expect(getAuthProjectConfig()).toEqual({ ok: false, error: 'auth_config_incomplete' });

    const result = await authenticate(bearer(crmToken()));
    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.SERVER_MISCONFIGURED, status: 500 });
    expect(getUserCalls).toHaveLength(0);
  });

  it('fails closed on a partial ROA data pair', () => {
    delete process.env.ROA_SUPABASE_SERVICE_ROLE_KEY;
    expect(getRoaDataConfig()).toEqual({ ok: false, error: 'roa_data_config_incomplete' });
    expect(() => getServerSupabase()).toThrow(/misconfigured/i);
  });

  it('rejects non-https and unparsable project URLs', () => {
    process.env.AUTH_SUPABASE_URL = 'http://mgqelduyralkdbsbwqcu.supabase.co';
    expect(getAuthProjectConfig()).toEqual({ ok: false, error: 'auth_config_invalid_url' });
    process.env.AUTH_SUPABASE_URL = 'not a url';
    expect(getAuthProjectConfig()).toEqual({ ok: false, error: 'auth_config_invalid_url' });
    process.env.AUTH_SUPABASE_URL = 'http://localhost:54321';
    expect(getAuthProjectConfig().ok).toBe(true);
  });
});

describe('token validation', () => {
  it('accepts a live, CRM-issued token for a confirmed user', async () => {
    getUserQueue.push(authVerdict());
    const result = await authenticate(bearer(crmToken()));
    expect(result).toEqual({
      ok: true,
      user: { id: 'crm-user-1', email: 'andrew@hrsinsurance.co.za' },
    });
  });

  it('rejects a token minted by the old ROA project after cutover — without asking any Auth service', async () => {
    const roaOnlyToken = makeTestJwt({ sub: 'crm-user-1', iss: ROA_ISSUER });
    const result = await authenticate(bearer(roaOnlyToken));

    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401, reason: 'issuer' });
    expect(getUserCalls).toHaveLength(0);
  });

  it('rejects an expired token (token_expired) without asking the Auth service', async () => {
    const expired = crmToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const result = await authenticate(bearer(expired));

    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.TOKEN_EXPIRED, status: 401, reason: 'expired' });
    expect(getUserCalls).toHaveLength(0);
  });

  it.each([
    ['not a jwt', 'abc'],
    ['two segments', 'aaa.bbb'],
    ['non-JSON segments', 'aaa.bbb.ccc'],
    ['empty signature segment', `${crmToken().split('.').slice(0, 2).join('.')}.`],
    ['alg "none"', makeTestJwt({ iss: CRM_ISSUER, alg: 'none' })],
    ['missing exp', makeTestJwt({ iss: CRM_ISSUER, omit: ['exp'] })],
    ['non-numeric exp', crmToken({ exp: 'soon' })],
    ['oversized token', `${crmToken()}${'A'.repeat(20000)}`],
  ])('rejects a malformed token: %s', async (_label, token) => {
    const result = await authenticate(bearer(token));
    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401 });
    expect(getUserCalls).toHaveLength(0);
  });

  it.each([
    ['wrong audience', { aud: 'something-else' }, 'audience'],
    ['anon key used as a bearer', { role: 'anon' }, 'role'],
    ['service_role used as a bearer', { role: 'service_role' }, 'role'],
    ['no subject', { sub: '' }, 'subject'],
  ])('rejects a token with %s', async (_label, claims, reason) => {
    const result = await authenticate(bearer(crmToken(claims)));
    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401, reason });
    expect(getUserCalls).toHaveLength(0);
  });

  it('accepts an audience array that includes "authenticated"', () => {
    const outcome = inspectAccessToken(crmToken({ aud: ['authenticated', 'other'] }), { issuer: CRM_ISSUER });
    expect(outcome.ok).toBe(true);
  });

  it('rejects a forged token — right shape and issuer, but the Auth service refuses its signature', async () => {
    getUserQueue.push({ data: { user: null }, error: { message: 'invalid JWT: signature is invalid', status: 401 } });
    const forged = crmToken({ signature: 'Zm9yZ2VkLXNpZ25hdHVyZQ' });
    const result = await authenticate(bearer(forged));

    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401, reason: 'rejected_by_auth_service' });
    expect(getUserCalls).toHaveLength(1);
  });

  it('rejects a signed-out / revoked session even though the JWT has not expired', async () => {
    getUserQueue.push({ data: { user: null }, error: { message: 'Session from session_id claim in JWT does not exist', status: 403 } });
    const result = await authenticate(bearer(crmToken()));
    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401 });
  });

  it('rejects a response whose user does not match the token subject', async () => {
    getUserQueue.push(authVerdict({ id: 'someone-else' }));
    const result = await authenticate(bearer(crmToken({ sub: 'crm-user-1' })));
    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401, reason: 'subject_mismatch' });
  });

  it('refuses a user whose email is not confirmed (403)', async () => {
    getUserQueue.push(authVerdict({ email_confirmed_at: null }));
    const result = await authenticate(bearer(crmToken()));
    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.EMAIL_NOT_CONFIRMED, status: 403 });
  });

  it('refuses anonymous and banned users', async () => {
    getUserQueue.push(authVerdict({ is_anonymous: true }));
    expect(await authenticate(bearer(crmToken()))).toMatchObject({ ok: false, status: 401, reason: 'anonymous_user' });

    getUserQueue.push(authVerdict({ banned_until: new Date(Date.now() + 3_600_000).toISOString() }));
    expect(await authenticate(bearer(crmToken()))).toMatchObject({ ok: false, error: AUTH_ERROR.USER_BANNED, status: 403 });

    // A ban that has lapsed no longer blocks.
    getUserQueue.push(authVerdict({ banned_until: new Date(Date.now() - 3_600_000).toISOString() }));
    expect((await authenticate(bearer(crmToken()))).ok).toBe(true);
  });

  it('fails closed (500) when the Auth service is unreachable or returns a server error', async () => {
    getUserQueue.push({ throw: 'ECONNRESET' });
    expect(await authenticate(bearer(crmToken()))).toMatchObject({ ok: false, error: AUTH_ERROR.AUTH_SERVICE_ERROR, status: 500 });

    getUserQueue.push({ data: { user: null }, error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 } });
    expect(await authenticate(bearer(crmToken()))).toMatchObject({ ok: false, error: AUTH_ERROR.AUTH_SERVICE_ERROR, status: 500 });

    getUserQueue.push({ data: { user: null }, error: { message: 'bad gateway', status: 502 } });
    expect(await authenticate(bearer(crmToken()))).toMatchObject({ ok: false, error: AUTH_ERROR.AUTH_SERVICE_ERROR, status: 500 });
  });

  it('requires a bearer credential', async () => {
    expect(await authenticate({ headers: {} })).toMatchObject({ ok: false, error: AUTH_ERROR.MISSING_TOKEN, status: 401 });
    expect(await authenticate({ headers: { authorization: 'Basic abc' } })).toMatchObject({ ok: false, status: 401 });
    expect(getUserCalls).toHaveLength(0);
  });
});

describe('authorisation is separate from authentication', () => {
  it('a valid CRM session for someone NOT on the approved list is denied (403) and touches no data', async () => {
    getUserQueue.push(authVerdict({ email: 'stranger@example.com' }));
    const res = mockRes();
    const user = await requireAuthenticatedBroker(bearer(crmToken()), res);

    expect(user).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'not_an_hrs_broker' });
    // Only the auth client was ever built — the ROA data project was not contacted.
    expect(clientCalls.every((c) => c.url === CRM_URL)).toBe(true);
  });

  it('a CRM user with a similar-looking email is not an approved broker', async () => {
    for (const email of [
      'andrew+roa@hrsinsurance.co.za',
      'andrew@hrsinsurance.co.za.evil.example',
      'andrew@hrsinsurance.com',
      'andrew@sub.hrsinsurance.co.za',
      'andrew@hrsinsurance.co.za\n',
    ]) {
      getUserQueue.push(authVerdict({ email }));
      const res = mockRes();
      expect(await requireAuthenticatedBroker(bearer(crmToken()), res)).toBeNull();
      expect(res.statusCode).toBe(403);
    }
  });

  it('an approved broker is authorised, case-insensitively, and carries a normalised identity', async () => {
    getUserQueue.push(authVerdict({ email: 'ANDREW@HRSInsurance.co.za' }));
    const res = mockRes();
    const user = await requireAuthenticatedBroker(bearer(crmToken()), res);

    expect(res.statusCode).toBeNull();
    expect(user).toEqual({
      id: 'crm-user-1',
      email: 'ANDREW@HRSInsurance.co.za',
      normalizedEmail: 'andrew@hrsinsurance.co.za',
      brokerName: 'Andrew Penney',
      brokerEmail: 'andrew@hrsinsurance.co.za',
    });
  });

  it('a user without an email claim is denied', async () => {
    getUserQueue.push(authVerdict({ email: undefined }));
    const res = mockRes();
    expect(await requireAuthenticatedBroker(bearer(crmToken()), res)).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it('the session probe reports the broker for an approved user and 403 for anyone else', async () => {
    getUserQueue.push(authVerdict());
    const ok = mockRes();
    await listHandler({ method: 'GET', query: { view: 'session' }, ...bearer(crmToken()) }, ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toEqual({
      ok: true,
      broker: { name: 'Andrew Penney', email: 'andrew@hrsinsurance.co.za' },
      authSource: 'explicit',
    });
    // The probe never reads the ROA database.
    expect(clientCalls.every((c) => c.url === CRM_URL)).toBe(true);

    getUserQueue.push(authVerdict({ email: 'stranger@example.com' }));
    const denied = mockRes();
    await listHandler({ method: 'GET', query: { view: 'session' }, ...bearer(crmToken()) }, denied);
    expect(denied.statusCode).toBe(403);
  });
});

describe('approved-broker directory resolution', () => {
  it('normalises only plain ASCII addresses', () => {
    expect(normalizeEmail('Andrew@HRSInsurance.co.za')).toBe('andrew@hrsinsurance.co.za');
    // No repair of malformed input: whitespace is rejected, not trimmed.
    expect(normalizeEmail(' andrew@hrsinsurance.co.za')).toBeNull();
    expect(normalizeEmail('andrew@hrsinsurance.co.za\n')).toBeNull();
    expect(normalizeEmail('juan-paul@hrsinsurance.co.za')).toBe('juan-paul@hrsinsurance.co.za');
    for (const bad of [null, undefined, 42, '', 'no-at-sign', 'a b@hrsinsurance.co.za', 'аndrew@hrsinsurance.co.za', 'andrew@hrsinsurance', '%@hrsinsurance.co.za', "o'brien@hrsinsurance.co.za"]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it('the shipped directory has no duplicate mailboxes (so no ambiguous identity)', () => {
    const emails = Object.values(BROKER_EMAIL_MAP).map(normalizeEmail);
    expect(emails.every(Boolean)).toBe(true);
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) expect(resolveBrokerByEmail(email).ok).toBe(true);
  });

  it('refuses to guess when two directory entries share a mailbox', () => {
    const ambiguous = { 'Broker One': 'shared@hrsinsurance.co.za', 'Broker Two': 'Shared@HRSInsurance.co.za' };
    expect(resolveBrokerByEmail('shared@hrsinsurance.co.za', ambiguous)).toEqual({
      ok: false, reason: 'ambiguous_directory',
    });
  });

  it('distinguishes invalid, unknown and approved emails', () => {
    expect(resolveBrokerByEmail('not an email')).toEqual({ ok: false, reason: 'invalid_email' });
    expect(resolveBrokerByEmail('stranger@example.com')).toEqual({ ok: false, reason: 'not_in_directory' });
    expect(resolveBrokerByEmail('Werner@hrsinsurance.co.za')).toMatchObject({
      ok: true, brokerName: 'Werner Joubert', normalizedEmail: 'werner@hrsinsurance.co.za',
    });
  });
});
