// Server-side authentication on /api/send-email and /api/send-for-signature
// (Phase ROA-0). Proves:
//   • Missing Authorization header → 401.
//   • Invalid / malformed / expired tokens → 401.
//   • Non-broker authenticated user → 403.
//   • Missing SUPABASE_JWT_SECRET → 500 (never a soft bypass).
//   • The external services (Resend and DocuSign) are NEVER contacted when
//     authentication fails — verified by asserting global.fetch was not called.

import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_ERROR, authenticate, requireAuthenticatedBroker } from '../api/_lib/auth.js';
import sendEmail from '../api/send-email.js';
import sendForSignature from '../api/send-for-signature.js';

const TEST_JWT_SECRET = 'test-jwt-secret-shhh';
const originalSecret = process.env.SUPABASE_JWT_SECRET;
const originalResend = process.env.RESEND_API_KEY;
const originalDocusignKey = process.env.DOCUSIGN_INTEGRATION_KEY;
const originalDocusignEnv = process.env.DOCUSIGN_ENVIRONMENT;

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function signValidToken({ email = 'andrew@hrsinsurance.co.za', sub = 'user-1', audience = 'authenticated', ttlSeconds = 60, secret = TEST_JWT_SECRET } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email, aud: audience })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(new TextEncoder().encode(secret));
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
  // Never let the endpoints actually contact Resend or DocuSign during tests.
  delete process.env.RESEND_API_KEY;
  delete process.env.DOCUSIGN_INTEGRATION_KEY;
  process.env.DOCUSIGN_ENVIRONMENT = 'sandbox';
  vi.spyOn(global, 'fetch').mockImplementation(() => {
    throw new Error('fetch must not be called during auth tests');
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv('SUPABASE_JWT_SECRET', originalSecret);
  restoreEnv('RESEND_API_KEY', originalResend);
  restoreEnv('DOCUSIGN_INTEGRATION_KEY', originalDocusignKey);
  restoreEnv('DOCUSIGN_ENVIRONMENT', originalDocusignEnv);
});

describe('authenticate() — Supabase JWT verification', () => {
  it('rejects a missing Authorization header (401)', async () => {
    const result = await authenticate({ headers: {} });
    expect(result).toEqual({ ok: false, error: AUTH_ERROR.MISSING_TOKEN, status: 401 });
  });

  it('rejects a malformed Authorization header (401)', async () => {
    const result = await authenticate({ headers: { authorization: 'not-a-bearer' } });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it('rejects a signature-mismatched token (401)', async () => {
    const badToken = await signValidToken({ secret: 'wrong-secret' });
    const result = await authenticate({ headers: { authorization: `Bearer ${badToken}` } });
    expect(result).toMatchObject({ ok: false, error: AUTH_ERROR.INVALID_TOKEN, status: 401 });
  });

  it('rejects an expired token (401)', async () => {
    const expired = await signValidToken({ ttlSeconds: -60 });
    const result = await authenticate({ headers: { authorization: `Bearer ${expired}` } });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a token issued for a different audience (401)', async () => {
    const wrongAud = await signValidToken({ audience: 'someone-else' });
    const result = await authenticate({ headers: { authorization: `Bearer ${wrongAud}` } });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it('accepts a valid audience="authenticated" token', async () => {
    const token = await signValidToken({ email: 'andrew@hrsinsurance.co.za' });
    const result = await authenticate({ headers: { authorization: `Bearer ${token}` } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.email).toBe('andrew@hrsinsurance.co.za');
  });

  it('returns server_misconfigured (500) if SUPABASE_JWT_SECRET is missing', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const token = await signValidToken();
    const result = await authenticate({ headers: { authorization: `Bearer ${token}` } });
    expect(result).toEqual({ ok: false, error: AUTH_ERROR.SERVER_MISCONFIGURED, status: 500 });
  });
});

describe('requireAuthenticatedBroker() — HRS-broker membership', () => {
  it('rejects an authenticated but non-broker email (403)', async () => {
    const token = await signValidToken({ email: 'stranger@example.com' });
    const res = mockRes();
    const user = await requireAuthenticatedBroker({ headers: { authorization: `Bearer ${token}` } }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'not_an_hrs_broker' });
  });

  it('accepts a known HRS broker (returns user)', async () => {
    const token = await signValidToken({ email: 'ANDREW@hrsinsurance.co.za' });
    const res = mockRes();
    const user = await requireAuthenticatedBroker({ headers: { authorization: `Bearer ${token}` } }, res);
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
    const res = mockRes();
    await sendEmail(
      { method: 'POST', headers: { authorization: 'Bearer garbage' }, body: { to: 'x@y', subject: 's', body: 'b' } },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('valid broker token + no RESEND_API_KEY → dev-mock 200 and never fetches Resend', async () => {
    const token = await signValidToken({ email: 'andrew@hrsinsurance.co.za' });
    const res = mockRes();
    await sendEmail(
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
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

  it('non-broker authenticated user → 403 and never fetches DocuSign', async () => {
    const token = await signValidToken({ email: 'stranger@example.com' });
    const res = mockRes();
    await sendForSignature(
      { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: validPayload },
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('authenticated broker whose email differs from requested broker → 403', async () => {
    const token = await signValidToken({ email: 'werner@hrsinsurance.co.za' });
    const res = mockRes();
    await sendForSignature(
      { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: validPayload },
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('unknown roaType → 400', async () => {
    const token = await signValidToken({ email: 'andrew@hrsinsurance.co.za' });
    const res = mockRes();
    await sendForSignature(
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: { ...validPayload, roaType: 'Motor' },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid roaType/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('valid broker token + no DocuSign credentials → dev mock 200 and never fetches DocuSign', async () => {
    const token = await signValidToken({ email: 'andrew@hrsinsurance.co.za' });
    const res = mockRes();
    await sendForSignature(
      { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: validPayload },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, envelopeId: 'dev-mock-envelope-id', environment: 'sandbox' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
