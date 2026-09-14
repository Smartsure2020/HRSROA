// End-to-end tests for the ROA-1 submission endpoints (create, get, pdf,
// attach-crm) using the in-memory Supabase mock. No external network.
//
// Covers §11 (canonical submit flow), §12 (email/download hash contract via
// pdf endpoint), §24 (cross-broker isolation), §29 (authorization tests).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';

// Shared mock: both api/_lib/auth.js (ANON client) and api/_lib/supabaseServer.js
// (service-role client) call createClient(); we return the same in-memory
// instance for both so writes are visible to reads within the same test.
const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mock.client,
}));

// Load handlers AFTER the mock is registered.
const createHandler = (await import('../api/roa-submissions/create.js')).default;
const getHandler = (await import('../api/roa-submissions/get.js')).default;
const pdfHandler = (await import('../api/roa-submissions/pdf.js')).default;
const attachCrmHandler = (await import('../api/roa-submissions/attach-crm.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');
const { sha256HexOfBytes } = await import('../api/_lib/sha256.js');

const originalEnv = { ...process.env };

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    _bytes: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(bytes) { this._bytes = bytes; return this; },
  };
}

function fakePdfBytes(marker = 'canonical') {
  // Real jsPDF output starts with '%PDF-'. The endpoint only requires >= 512
  // bytes and successful base64 decode, so we can build a synthetic payload.
  const body = `%PDF-1.4\n${marker}\n${'x'.repeat(600)}\n%%EOF`;
  return Buffer.from(body, 'utf8');
}

function goodVersions() {
  return {
    templateVersion: 'HRS-TEMPLATE-2026-01',
    statutoryDisclosureVersion: 'HRS-STAT-DISC-2026-01',
    brokerAppointmentVersion: 'HRS-BROKER-APPT-2026-01',
    brokerFeeVersion: 'HRS-BROKER-FEE-2026-01',
    letterInvestigationVersion: 'HRS-LETTER-INVESTIGATION-2026-01',
  };
}

function personalSnapshot() {
  return { firstName: 'Jane', surname: 'Doe', brokerName: 'Andrew Penney', recInsurer: 'Stratsys' };
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  _resetServerSupabaseForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});

  // Two brokers exercised by these tests.
  mock.fixtures.addAuthUser('token-andrew', { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
  mock.fixtures.addAuthUser('token-werner', { id: 'user-werner', email: 'werner@hrsinsurance.co.za' });
  mock.fixtures.addAuthUser('token-stranger', { id: 'user-stranger', email: 'stranger@example.com' });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) {
    if (!(k in originalEnv)) delete process.env[k];
  }
  Object.assign(process.env, originalEnv);
});

async function createFor(broker, overrides = {}) {
  const submissionId = overrides.submissionId ?? generateSubmissionId();
  const bytes = overrides.bytes ?? fakePdfBytes(submissionId);
  const res = mockRes();
  await createHandler(
    {
      method: 'POST',
      headers: { authorization: `Bearer ${broker}` },
      body: {
        submissionId,
        roaType: overrides.roaType ?? 'Personal',
        snapshot: overrides.snapshot ?? personalSnapshot(),
        versions: overrides.versions ?? goodVersions(),
        pdfBase64: bytes.toString('base64'),
      },
    },
    res,
  );
  return { res, submissionId, bytes };
}

describe('/api/roa-submissions/create', () => {
  it('rejects unauthenticated (no bearer) → 401', async () => {
    const res = mockRes();
    await createHandler({ method: 'POST', headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid submissionId → 400', async () => {
    const res = mockRes();
    await createHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer token-andrew' },
        body: {
          submissionId: 'not-a-uuid',
          roaType: 'Personal',
          snapshot: personalSnapshot(),
          versions: goodVersions(),
          pdfBase64: fakePdfBytes().toString('base64'),
        },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/submissionId/);
  });

  it('rejects an impossibly small PDF → 400', async () => {
    const res = mockRes();
    await createHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer token-andrew' },
        body: {
          submissionId: generateSubmissionId(),
          roaType: 'Personal',
          snapshot: personalSnapshot(),
          versions: goodVersions(),
          pdfBase64: Buffer.from('too small').toString('base64'),
        },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/impossibly small/);
  });

  it('persists a row, uploads canonical bytes, and returns SHA-256', async () => {
    const { res, submissionId, bytes } = await createFor('token-andrew');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.submissionId).toBe(submissionId);
    expect(res.body.pdfSha256).toBe(sha256HexOfBytes(bytes));
    expect(res.body.status).toBe('submitted');

    const row = mock.fixtures.getRow(submissionId);
    expect(row.pdf_sha256).toBe(sha256HexOfBytes(bytes));
    expect(row.advisor_user_id).toBe('user-andrew');
    expect(row.pdf_storage_path).toBe(`${submissionId}/canonical.pdf`);
    // Sensitive banking / ID data must not appear in storage paths.
    expect(row.pdf_storage_path).not.toContain('Doe');
    expect(row.pdf_storage_path).not.toContain('@');

    const stored = mock.fixtures.getStorage(`${submissionId}/canonical.pdf`);
    expect(stored.equals(bytes)).toBe(true);
  });
});

describe('/api/roa-submissions/get — ownership + safe 404', () => {
  it('rejects unauthenticated → 401', async () => {
    const res = mockRes();
    await getHandler({ method: 'GET', headers: {}, query: { id: 'anything' } }, res);
    expect(res.statusCode).toBe(401);
  });

  it('owner sees their own submission', async () => {
    const { submissionId } = await createFor('token-andrew');
    const res = mockRes();
    await getHandler(
      { method: 'GET', headers: { authorization: 'Bearer token-andrew' }, query: { id: submissionId } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.submission.submissionId).toBe(submissionId);
    // Full snapshot must NOT be shipped to the browser.
    expect(res.body.submission).not.toHaveProperty('snapshot_json');
    expect(res.body.submission.pdfSha256).toBeDefined();
  });

  it('cross-broker → 404 (existence is not leaked)', async () => {
    const { submissionId } = await createFor('token-andrew');
    const res = mockRes();
    await getHandler(
      { method: 'GET', headers: { authorization: 'Bearer token-werner' }, query: { id: submissionId } },
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  it('non-HRS-broker authenticated user → 403 before any lookup', async () => {
    const res = mockRes();
    await getHandler(
      { method: 'GET', headers: { authorization: 'Bearer token-stranger' }, query: { id: 'ROA-x' } },
      res,
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('not_an_hrs_broker');
  });
});

describe('/api/roa-submissions/pdf — evidence hash verification', () => {
  it('serves canonical bytes to the owner with the persisted hash', async () => {
    const { submissionId, bytes } = await createFor('token-andrew');
    const res = mockRes();
    await pdfHandler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer token-andrew' },
        query: { id: submissionId, kind: 'canonical' },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res._bytes.equals(bytes)).toBe(true);
  });

  it('cross-broker canonical download → 404', async () => {
    const { submissionId } = await createFor('token-andrew');
    const res = mockRes();
    await pdfHandler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer token-werner' },
        query: { id: submissionId, kind: 'canonical' },
      },
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  it('signed download → 409 while no signed.pdf exists yet', async () => {
    const { submissionId } = await createFor('token-andrew');
    const res = mockRes();
    await pdfHandler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer token-andrew' },
        query: { id: submissionId, kind: 'signed' },
      },
      res,
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('signed_not_available');
  });

  it('detects storage corruption via SHA-256 mismatch → 500', async () => {
    const { submissionId } = await createFor('token-andrew');
    // Simulate someone (or something) replacing the object bytes.
    mock.fixtures.deleteStorage(`${submissionId}/canonical.pdf`);
    mock.fixtures.putStorage(`${submissionId}/canonical.pdf`, Buffer.from('corrupted'.repeat(60)));
    const res = mockRes();
    await pdfHandler(
      {
        method: 'GET',
        headers: { authorization: 'Bearer token-andrew' },
        query: { id: submissionId, kind: 'canonical' },
      },
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('evidence_hash_mismatch');
  });
});

describe('/api/roa-submissions/attach-crm', () => {
  it('owner attaches crm ids; row is updated', async () => {
    const { submissionId } = await createFor('token-andrew');
    const res = mockRes();
    await attachCrmHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer token-andrew' },
        body: { submissionId, crmClientId: 'C-42', crmDealId: 'D-7' },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.submission.crmClientId).toBe('C-42');
    expect(res.body.submission.crmDealId).toBe('D-7');
    const row = mock.fixtures.getRow(submissionId);
    expect(row.crm_client_id).toBe('C-42');
    expect(row.crm_deal_id).toBe('D-7');
  });

  it('cross-broker attach → 404, no side effect', async () => {
    const { submissionId } = await createFor('token-andrew');
    const res = mockRes();
    await attachCrmHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer token-werner' },
        body: { submissionId, crmClientId: 'C-42', crmDealId: 'D-7' },
      },
      res,
    );
    expect(res.statusCode).toBe(404);
    const row = mock.fixtures.getRow(submissionId);
    expect(row.crm_client_id).toBeUndefined();
  });

  it('no ids supplied → 400', async () => {
    const { submissionId } = await createFor('token-andrew');
    const res = mockRes();
    await attachCrmHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer token-andrew' },
        body: { submissionId },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
  });
});
