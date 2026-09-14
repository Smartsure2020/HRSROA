// Server-side authentication on /api/send-email and /api/send-for-signature
// (Phase ROA-0.1).
//
// The endpoints now delegate token validation to the project's Supabase Auth
// service via `supabase.auth.getUser(token)`. This test file mocks
// `@supabase/supabase-js` so the entire suite runs offline: no HS256 secret,
// no real Supabase call, no DocuSign call, no Resend call.
//
// Coverage:
//   • Missing bearer → 401
//   • Malformed bearer → 401
//   • Supabase Auth says "invalid" → 401
//   • Supabase Auth infra failure (getUser throws) → 500 (fail-closed)
//   • SUPABASE_URL / SUPABASE_ANON_KEY missing → 500 server_misconfigured
//   • Valid Supabase user but not in HRS broker directory → 403
//   • Authenticated broker whose email ≠ requested broker → 403
//   • Unknown roaType → 400
//   • Valid broker + no external creds → dev-mock 200
//   • external Resend / DocuSign fetch never called on any auth failure

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The mock queue lets each test push the next `getUser` response before it
// calls the handler. This keeps the mock deterministic across handler calls.
const getUserResponses = [];
function pushGetUserResponse(response) {
  getUserResponses.push(response);
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => {
        if (!getUserResponses.length) {
          return { data: { user: null }, error: { message: 'no mock response queued' } };
        }
        const next = getUserResponses.shift();
        if (typeof next === 'function') return next();
        if (next && typeof next.throw === 'string') throw new Error(next.throw);
        return next;
      }),
    },
  })),
}));

// Loaded AFTER vi.mock so the handlers pick up the mocked module.
const { AUTH_ERROR, authenticate, requireAuthenticatedBroker } = await import('../api/_lib/auth.js');
const sendEmail = (await import('../api/send-email.js')).default;
const sendForSignature = (await import('../api/send-for-signature.js')).default;

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseAnon = process.env.SUPABASE_ANON_KEY;
const originalResend = process.env.RESEND_API_KEY;
const originalDocusignKey = process.env.DOCUSIGN_INTEGRATION_KEY;
const originalDocusignEnv = process.env.DOCUSIGN_ENVIRONMENT;

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function validSupabaseUser(email) {
  return {
    data: { user: { id: `user-${email}`, email } },
    error: null,
  };
}

const invalidTokenResponse = { data: { user: null }, error: { message: 'invalid JWT' } };

beforeEach(() => {
  getUserResponses.length = 0;
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-tests';
  delete process.env.RESEND_API_KEY;
  delete process.env.DOCUSIGN_INTEGRATION_KEY;
  process.env.DOCUSIGN_ENVIRONMENT = 'sandbox';
  vi.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called during auth-failure tests');
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv('SUPABASE_URL', originalSupabaseUrl);
  restoreEnv('SUPABASE_ANON_KEY', originalSupabaseAnon);
  restoreEnv('RESEND_API_KEY', originalResend);
  restoreEnv('DOCUSIGN_INTEGRATION_KEY', originalDocusignKey);
  restoreEnv('DOCUSIGN_ENVIRONMENT', originalDocusignEnv);
});

describe('authenticate() — Supabase Auth token verification', () => {
  it('rejects a missing Authorization header (401 missing_token)', async () => {
    const result = await authenticate({ headers: {} });
    expect(result).toEqual({ ok: false, error: AUTH_ERROR.MISSING_TOKEN, status: 401 });
  });

  it('rejects a malformed Authorization header (401)', async () => {
    const result = await authenticate({ headers: { authorization: 'not-a-bearer' } });
    expect(result).toEqual({ ok: false, error: AUTH_ERROR.MISSING_TOKEN, status: 401 });
  });

  it('returns server_misconfigured (500) when SUPABASE_URL is missing', async () => {
    delete process.env.SUPABASE_URL;
    const result = await authenticate({ headers: { authorization: 'Bearer whatever' } });
    expect(result).toEqual({ ok: false, error: AUTH_ERROR.SERVER_MISCONFIGURED, status: 500 });
  });

  it('returns server_misconfigured (500) when SUPABASE_ANON_KEY is missing', async () => {
    delete process.env.SUPABASE_ANON_KEY;
    const result = await authenticate({ headers: { authorization: 'Bearer whatever' } });
    expect(result).toEqual({ ok: false, error: AUTH_ERROR.SERVER_MISCONFIGURED, status: 500 });
  });

  it('rejects a token Supabase Auth says is invalid (401)', async () => {
    pushGetUserResponse(invalidTokenResponse);
    const result = await authenticate({ headers: { authorization: 'Bearer garbage' } });
    expect(result).toEqual({ ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401 });
  });

  it('fails closed (500 auth_service_error) when Supabase Auth throws', async () => {
    pushGetUserResponse({ throw: 'ECONNRESET' });
    const result = await authenticate({ headers: { authorization: 'Bearer good-shape' } });
    expect(result).toEqual({ ok: false, error: AUTH_ERROR.AUTH_SERVICE_ERROR, status: 500 });
  });

  it('accepts a valid Supabase user (returns id + email)', async () => {
    pushGetUserResponse(validSupabaseUser('andrew@hrsinsurance.co.za'));
    const result = await authenticate({ headers: { authorization: 'Bearer good' } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.email).toBe('andrew@hrsinsurance.co.za');
      expect(result.user.id).toBe('user-andrew@hrsinsurance.co.za');
    }
  });
});

describe('requireAuthenticatedBroker() — HRS-broker membership', () => {
  it('rejects an authenticated but non-broker email (403)', async () => {
    pushGetUserResponse(validSupabaseUser('stranger@example.com'));
    const res = mockRes();
    const user = await requireAuthenticatedBroker({ headers: { authorization: 'Bearer good' } }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'not_an_hrs_broker' });
  });

  it('accepts a known HRS broker (case-insensitive)', async () => {
    pushGetUserResponse(validSupabaseUser('ANDREW@hrsinsurance.co.za'));
    const res = mockRes();
    const user = await requireAuthenticatedBroker({ headers: { authorization: 'Bearer good' } }, res);
    expect(user).not.toBeNull();
    expect(user.email).toBe('ANDREW@hrsinsurance.co.za');
    expect(res.statusCode).toBeNull();
  });
});

describe('/api/send-email — rejects unauthenticated callers before touching Resend', () => {
  it('missing token → 401 and never fetches Resend', async () => {
    const res = mockRes();
    await sendEmail(
      { method: 'POST', headers: {}, body: { to: 'x@y', subject: 's', body: 'b' } },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('invalid token → 401 and never fetches Resend', async () => {
    pushGetUserResponse(invalidTokenResponse);
    const res = mockRes();
    await sendEmail(
      { method: 'POST', headers: { authorization: 'Bearer garbage' }, body: { to: 'x@y', subject: 's', body: 'b' } },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('Supabase Auth infra failure → 500 and never fetches Resend', async () => {
    pushGetUserResponse({ throw: 'ENETUNREACH' });
    const res = mockRes();
    await sendEmail(
      { method: 'POST', headers: { authorization: 'Bearer good-shape' }, body: { to: 'x@y', subject: 's', body: 'b' } },
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'auth_service_error' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('valid broker + no RESEND_API_KEY → dev-mock 200 and never fetches Resend', async () => {
    pushGetUserResponse(validSupabaseUser('andrew@hrsinsurance.co.za'));
    const res = mockRes();
    await sendEmail(
      {
        method: 'POST',
        headers: { authorization: 'Bearer good' },
        body: { to: 'andrew@hrsinsurance.co.za', subject: 's', body: 'b' },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, id: 'dev-mock' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('/api/send-for-signature — rejects unauthenticated callers before touching DocuSign', () => {
  const validPayload = {
    signerName: 'Test Client',
    signerEmail: 'client@example.com',
    brokerName: 'Andrew Penney',
    brokerEmail: 'andrew@hrsinsurance.co.za',
    pdfBase64: 'YmFzZTY0',
    pdfFilename: 'HRS_ROA.pdf',
    roaType: 'Personal',
  };

  it('missing token → 401 and never fetches DocuSign', async () => {
    const res = mockRes();
    await sendForSignature({ method: 'POST', headers: {}, body: validPayload }, res);
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('invalid Supabase token → 401 and never fetches DocuSign', async () => {
    pushGetUserResponse(invalidTokenResponse);
    const res = mockRes();
    await sendForSignature(
      { method: 'POST', headers: { authorization: 'Bearer bad' }, body: validPayload },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('non-broker authenticated user → 403 and never fetches DocuSign', async () => {
    pushGetUserResponse(validSupabaseUser('stranger@example.com'));
    const res = mockRes();
    await sendForSignature(
      { method: 'POST', headers: { authorization: 'Bearer good' }, body: validPayload },
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('authenticated broker whose email differs from requested broker → 403', async () => {
    pushGetUserResponse(validSupabaseUser('werner@hrsinsurance.co.za'));
    const res = mockRes();
    await sendForSignature(
      { method: 'POST', headers: { authorization: 'Bearer good' }, body: validPayload },
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('unknown roaType → 400 and never fetches DocuSign', async () => {
    pushGetUserResponse(validSupabaseUser('andrew@hrsinsurance.co.za'));
    const res = mockRes();
    await sendForSignature(
      {
        method: 'POST',
        headers: { authorization: 'Bearer good' },
        body: { ...validPayload, roaType: 'Motor' },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid roaType/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('valid broker + no DocuSign credentials → dev mock 200 and never fetches DocuSign', async () => {
    pushGetUserResponse(validSupabaseUser('andrew@hrsinsurance.co.za'));
    const res = mockRes();
    await sendForSignature(
      { method: 'POST', headers: { authorization: 'Bearer good' }, body: validPayload },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, envelopeId: 'dev-mock-envelope-id', environment: 'sandbox' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
