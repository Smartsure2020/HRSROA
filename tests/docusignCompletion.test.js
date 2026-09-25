// DocuSign status polling + completed-evidence retrieval (Phase ROA-1
// §17-§20, §30).
//
// Uses the real send-for-signature and refresh handlers, with:
//   • @supabase/supabase-js mocked to the in-memory client
//   • global.fetch mocked to script each DocuSign call
//
// So all outbound network is replaced with declarative fixtures.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mock.client,
}));

// The auth's HS→asymmetric future migration is orthogonal — DocuSign JWT
// still uses jose/importPKCS8 which loads the RSA key. Provide a minimal
// stub for the JWT helper so we do not need a real key in tests.
vi.mock('../api/_lib/docusignJwt.js', () => ({
  getDocusignAccessToken: vi.fn(async () => 'mock-access-token'),
}));

// Bypass the OAuth UserInfo hop; assume base URI is resolved.
vi.mock('../api/_lib/docusignAccount.js', () => ({
  resolveDocusignAccountBaseUrl: vi.fn(async () => ({ baseUrl: 'https://na99.docusign.net/restapi' })),
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const sendHandler = (await import('../api/roa-submissions/send-for-signature.js')).default;
const refreshHandler = (await import('../api/roa-submissions/refresh.js')).default;
const { setCompletionIfMissing } = await import('../api/_lib/submissionRepo.js');
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };

function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    send() { return this; },
  };
}
function fakePdfBytes(m) { return Buffer.from(`%PDF-1.4\n${m}\n${'x'.repeat(600)}\n%%EOF`); }

let fetchScript;
function pushFetchResponse(entry) { fetchScript.push(entry); }

function jsonResponse(payload, ok = true, status = ok ? 200 : 500) {
  return {
    ok, status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
    async arrayBuffer() { return Buffer.from(JSON.stringify(payload)).buffer; },
  };
}
function pdfResponse(bytes, ok = true, status = ok ? 200 : 500) {
  return {
    ok, status,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    async text() { return `binary ${bytes.length}`; },
    async json() { throw new Error('not json'); },
  };
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.DOCUSIGN_ENVIRONMENT = 'sandbox';
  process.env.DOCUSIGN_INTEGRATION_KEY = 'ik-test';
  process.env.DOCUSIGN_USER_ID = 'user-test';
  process.env.DOCUSIGN_ACCOUNT_ID = 'acct-test';
  _resetServerSupabaseForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  fetchScript = [];
  vi.spyOn(global, 'fetch').mockImplementation(async () => {
    if (!fetchScript.length) throw new Error('fetch called with no scripted response');
    return fetchScript.shift();
  });
  mock.fixtures.addAuthUser('token-andrew', { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
  mock.fixtures.addAuthUser('token-werner', { id: 'user-werner', email: 'werner@hrsinsurance.co.za' });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
  Object.assign(process.env, originalEnv);
});

async function seedSubmission(token = 'token-andrew') {
  const submissionId = generateSubmissionId();
  const res = mockRes();
  await createHandler(
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: {
        submissionId,
        roaType: 'Personal',
        snapshot: { firstName: 'Jane', surname: 'Doe', email: 'jane@example.com', brokerName: 'Andrew Penney' },
        versions: {
          templateVersion: 'T', statutoryDisclosureVersion: 'S',
          brokerAppointmentVersion: 'A', brokerFeeVersion: 'F',
        },
        pdfBase64: fakePdfBytes(submissionId).toString('base64'),
      },
    },
    res,
  );
  return submissionId;
}

async function sendReal(token, submissionId, { envelopeId = 'env-real-1', envelopeStatus = 'sent' } = {}) {
  // First the send-for-signature endpoint calls DocuSign envelopes POST.
  pushFetchResponse(jsonResponse({ envelopeId, status: envelopeStatus }));
  const res = mockRes();
  await sendHandler(
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: { submissionId, signerName: 'Jane Doe', signerEmail: 'jane@example.com' },
    },
    res,
  );
  return res;
}

async function refreshCall(token, submissionId) {
  const res = mockRes();
  await refreshHandler(
    { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { submissionId } },
    res,
  );
  return res;
}

describe('DocuSign real-envelope send + status persistence', () => {
  it('creates the envelope, persists id + status, uses the account-specific base URI', async () => {
    const id = await seedSubmission();
    const r = await sendReal('token-andrew', id, { envelopeId: 'env-abc', envelopeStatus: 'sent' });
    expect(r.statusCode).toBe(200);
    expect(r.body.envelopeId).toBe('env-abc');
    const row = mock.fixtures.getRow(id);
    expect(row.docusign_envelope_id).toBe('env-abc');
    expect(row.docusign_status).toBe('sent');
    expect(row.status).toBe('awaiting_signature');
    expect(row.sent_for_signature_at).toBeDefined();
  });

  it('a subsequent send returns the same envelope (no duplicate DocuSign call)', async () => {
    const id = await seedSubmission();
    await sendReal('token-andrew', id, { envelopeId: 'env-x' });
    // No fetch scripted for the second call — if the endpoint tried to hit
    // DocuSign again, the fetch mock would throw.
    const res = mockRes();
    await sendHandler(
      {
        method: 'POST', headers: { authorization: 'Bearer token-andrew' },
        body: { submissionId: id, signerName: 'X', signerEmail: 'x@y.co' },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.alreadySent).toBe(true);
    expect(res.body.envelopeId).toBe('env-x');
  });

  it('rolls back the reservation when DocuSign returns a definite error', async () => {
    const id = await seedSubmission();
    pushFetchResponse(jsonResponse({ errorCode: 'INVALID_REQ' }, false, 400));
    const res = mockRes();
    await sendHandler(
      {
        method: 'POST', headers: { authorization: 'Bearer token-andrew' },
        body: { submissionId: id, signerName: 'J', signerEmail: 'j@y.co' },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    const row = mock.fixtures.getRow(id);
    expect(row.docusign_envelope_id).toBeUndefined();
    expect(row.status).toBe('signature_failed');
    // A subsequent retry can proceed because the WHERE clause matches
    // status IN ('submitted','signature_failed') AND envelope_id IS NULL.
    pushFetchResponse(jsonResponse({ envelopeId: 'env-retry', status: 'sent' }));
    const retry = await sendReal('token-andrew', id, { envelopeId: 'env-retry' });
    expect(retry.statusCode).toBe(200);
    expect(retry.body.envelopeId).toBe('env-retry');
  });
});

describe('refresh — polling DocuSign', () => {
  it('preserves the first completed_at value across competing observations', async () => {
    const id = await seedSubmission();
    const firstObserved = '2026-09-25T08:00:00.000Z';
    const laterObserved = '2026-09-25T08:00:05.000Z';

    await setCompletionIfMissing(id, 'user-andrew', firstObserved);
    await setCompletionIfMissing(id, 'user-andrew', laterObserved);

    expect(mock.fixtures.getRow(id).completed_at).toBe(firstObserved);
  });

  it('sent → persists observed status, does not create signed/certificate objects', async () => {
    const id = await seedSubmission();
    await sendReal('token-andrew', id, { envelopeId: 'env-1', envelopeStatus: 'sent' });
    pushFetchResponse(jsonResponse({ status: 'delivered' }));
    const r = await refreshCall('token-andrew', id);
    expect(r.statusCode).toBe(200);
    expect(r.body.observedStatus).toBe('delivered');
    const row = mock.fixtures.getRow(id);
    expect(row.docusign_status).toBe('delivered');
    expect(row.status).toBe('awaiting_signature');
    expect(row.signed_pdf_storage_path).toBeUndefined();
  });

  it('completed → retrieves signed PDF + certificate, marks evidence retrieved', async () => {
    const id = await seedSubmission();
    await sendReal('token-andrew', id, { envelopeId: 'env-c', envelopeStatus: 'sent' });
    // Refresh flow: status → signed pdf → certificate.
    pushFetchResponse(jsonResponse({ status: 'completed' }));
    const signedBytes = Buffer.from('%PDF-1.4\nSIGNED\n');
    const certBytes = Buffer.from('%PDF-1.4\nCERT\n');
    pushFetchResponse(pdfResponse(signedBytes));
    pushFetchResponse(pdfResponse(certBytes));
    const r = await refreshCall('token-andrew', id);
    expect(r.statusCode).toBe(200);
    expect(r.body.observedStatus).toBe('completed');
    const row = mock.fixtures.getRow(id);
    expect(row.status).toBe('completed');
    expect(row.docusign_status).toBe('completed');
    expect(row.signed_pdf_storage_path).toBe(`${id}/signed.pdf`);
    expect(row.certificate_storage_path).toBe(`${id}/certificate.pdf`);
    expect(row.completed_at).toBeDefined();
    expect(row.evidence_retrieved_at).toBeDefined();
    // The bytes we uploaded are exactly what DocuSign returned.
    expect(mock.fixtures.getStorage(`${id}/signed.pdf`).equals(signedBytes)).toBe(true);
    expect(mock.fixtures.getStorage(`${id}/certificate.pdf`).equals(certBytes)).toBe(true);
  });

  it('completed + certificate retrieval fails → signed stored, evidence_retrieved_at NOT set, retry succeeds', async () => {
    const id = await seedSubmission();
    await sendReal('token-andrew', id, { envelopeId: 'env-cx', envelopeStatus: 'sent' });
    // First refresh: status ok, signed ok, certificate fails.
    pushFetchResponse(jsonResponse({ status: 'completed' }));
    const signedBytes = Buffer.from('%PDF-1.4\nSIGNED-2\n');
    pushFetchResponse(pdfResponse(signedBytes));
    pushFetchResponse(pdfResponse(Buffer.from(''), false, 502));
    const r1 = await refreshCall('token-andrew', id);
    expect(r1.body.evidenceErrors).toEqual(['certificate']);
    const row1 = mock.fixtures.getRow(id);
    expect(row1.signed_pdf_storage_path).toBe(`${id}/signed.pdf`);
    expect(row1.certificate_storage_path).toBeUndefined();
    expect(row1.evidence_retrieved_at).toBeUndefined();
    // Retry: status ok, certificate ok (signed skipped because already stored).
    pushFetchResponse(jsonResponse({ status: 'completed' }));
    const certBytes = Buffer.from('%PDF-1.4\nCERT-2\n');
    pushFetchResponse(pdfResponse(certBytes));
    const r2 = await refreshCall('token-andrew', id);
    expect(r2.body.evidenceErrors).toBeUndefined();
    const row2 = mock.fixtures.getRow(id);
    expect(row2.certificate_storage_path).toBe(`${id}/certificate.pdf`);
    expect(row2.evidence_retrieved_at).toBeDefined();
  });

  it('declined → persisted, no signed/certificate fetch attempted', async () => {
    const id = await seedSubmission();
    await sendReal('token-andrew', id, { envelopeId: 'env-d', envelopeStatus: 'sent' });
    pushFetchResponse(jsonResponse({ status: 'declined' }));
    const r = await refreshCall('token-andrew', id);
    expect(r.statusCode).toBe(200);
    expect(r.body.observedStatus).toBe('declined');
    const row = mock.fixtures.getRow(id);
    expect(row.status).toBe('declined');
    expect(row.completed_at ?? null).toBeNull();
    expect(row.signed_pdf_storage_path).toBeUndefined();
  });

  it('voided → persisted, no signed fetch', async () => {
    const id = await seedSubmission();
    await sendReal('token-andrew', id, { envelopeId: 'env-v', envelopeStatus: 'sent' });
    pushFetchResponse(jsonResponse({ status: 'voided' }));
    const r = await refreshCall('token-andrew', id);
    expect(r.body.observedStatus).toBe('voided');
    const row = mock.fixtures.getRow(id);
    expect(row.status).toBe('voided');
    expect(row.completed_at ?? null).toBeNull();
    expect(row.signed_pdf_storage_path).toBeUndefined();
  });

  it('expired → persisted but completed_at remains null', async () => {
    const id = await seedSubmission();
    await sendReal('token-andrew', id, { envelopeId: 'env-e', envelopeStatus: 'sent' });
    pushFetchResponse(jsonResponse({ status: 'expired' }));
    const r = await refreshCall('token-andrew', id);
    expect(r.body.observedStatus).toBe('expired');
    const row = mock.fixtures.getRow(id);
    expect(row.status).toBe('expired');
    expect(row.completed_at ?? null).toBeNull();
    expect(row.signed_pdf_storage_path).toBeUndefined();
  });

  it('cross-broker refresh → 404 (no state observed, no DocuSign call)', async () => {
    const id = await seedSubmission();
    await sendReal('token-andrew', id, { envelopeId: 'env-owned' });
    // No fetch scripted — a stray call would throw.
    const r = await refreshCall('token-werner', id);
    expect(r.statusCode).toBe(404);
  });

  it('refresh before send has an envelope → returns current state without contacting DocuSign', async () => {
    const id = await seedSubmission();
    const r = await refreshCall('token-andrew', id);
    expect(r.statusCode).toBe(200);
    expect(r.body.refreshed).toBe(false);
  });
});
