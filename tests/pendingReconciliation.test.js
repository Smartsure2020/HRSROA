import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));
vi.mock('../api/_lib/docusignJwt.js', () => ({ getDocusignAccessToken: vi.fn(async () => 'unused') }));
vi.mock('../api/_lib/docusignAccount.js', () => ({
  resolveDocusignAccountBaseUrl: vi.fn(async () => ({ baseUrl: 'https://unused.test' })),
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const reconcilePendingHandler = (await import('../api/roa-submissions/reconcile-pending.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };

function res() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function pdfResponse(label) {
  const bytes = Buffer.from(`%PDF-1.4\n${label}\n%%EOF`);
  return {
    ok: true,
    status: 200,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

async function seed(token = 'token-andrew') {
  const submissionId = generateSubmissionId();
  const response = res();
  const pdf = Buffer.from(`%PDF-1.4\n${submissionId}\n${'x'.repeat(600)}\n%%EOF`);
  await createHandler({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      submissionId,
      roaType: 'Personal',
      snapshot: { firstName: 'Jane', surname: 'Doe', email: 'jane@example.com', brokerName: 'Andrew Penney' },
      versions: { templateVersion: 'T', statutoryDisclosureVersion: 'S', brokerAppointmentVersion: 'A', brokerFeeVersion: 'F' },
      pdfBase64: pdf.toString('base64'),
    },
  }, response);
  expect(response.statusCode).toBe(200);
  return submissionId;
}

async function reconcile(token = 'token-andrew') {
  const response = res();
  await reconcilePendingHandler({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {},
  }, response);
  return response;
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.DOCUMENSO_BASE_URL = 'https://sign.example.test';
  process.env.DOCUMENSO_API_TOKEN = 'api-test';
  mock.fixtures.reset();
  _resetServerSupabaseForTests();
  mock.fixtures.addAuthUser('token-andrew', { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
  mock.fixtures.addAuthUser('token-werner', { id: 'user-werner', email: 'werner@hrsinsurance.co.za' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

describe('broker-scoped pending signing reconciliation', () => {
  it('reconciles Spot 1 from Documenso COMPLETED and retains all required evidence idempotently', async () => {
    const id = await seed();
    const completedAt = '2026-09-30T08:15:00.000Z';
    mock.fixtures.putRow(id, {
      status: 'awaiting_signature',
      signing_provider: 'documenso',
      signing_status: 'pending',
      signing_envelope_id: 'spot-1-env',
      signing_item_id: 'spot-1-item',
    });
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const href = String(url);
      if (href.endsWith('/envelope/spot-1-env')) return jsonResponse({
        id: 'spot-1-env', status: 'COMPLETED', completedAt, envelopeItems: [{ id: 'spot-1-item' }],
      });
      if (href.includes('/envelope/item/spot-1-item/download')) return pdfResponse('signed');
      if (href.includes('/envelope/spot-1-env/certificate/download')) return pdfResponse('certificate');
      if (href.includes('/envelope/spot-1-env/audit-log/download')) return pdfResponse('audit');
      throw new Error(`Unexpected URL ${href}`);
    });

    const first = await reconcile();
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    const row = mock.fixtures.getRow(id);
    expect(row.status).toBe('completed');
    expect(row.signing_status).toBe('completed');
    expect(row.completed_at).toBe(completedAt);
    expect(row.signed_pdf_storage_path).toBe(`${id}/signed.pdf`);
    expect(row.certificate_storage_path).toBe(`${id}/certificate.pdf`);
    expect(row.audit_log_storage_path).toBe(`${id}/audit-log.pdf`);
    expect(row.signed_pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.certificate_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.audit_log_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.evidence_retrieved_at).toBeTruthy();
    const evidenceRetrievedAt = row.evidence_retrieved_at;

    const second = await reconcile();
    expect(second.body.attempted).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(mock.fixtures.getRow(id).evidence_retrieved_at).toBe(evidenceRetrievedAt);
  });

  it('never exposes or reconciles another broker\'s submission', async () => {
    const id = await seed('token-andrew');
    mock.fixtures.putRow(id, {
      status: 'awaiting_signature', signing_provider: 'documenso', signing_status: 'pending', signing_envelope_id: 'private-env',
    });
    const fetchSpy = vi.spyOn(global, 'fetch');
    const response = await reconcile('token-werner');
    expect(response.statusCode).toBe(200);
    expect(response.body.attempted).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips terminal rows without calling the provider', async () => {
    const id = await seed();
    mock.fixtures.putRow(id, {
      status: 'completed', signing_provider: 'documenso', signing_status: 'completed', signing_envelope_id: 'done-env',
      signed_pdf_storage_path: `${id}/signed.pdf`, certificate_storage_path: `${id}/certificate.pdf`, audit_log_storage_path: `${id}/audit-log.pdf`,
    });
    const fetchSpy = vi.spyOn(global, 'fetch');
    const response = await reconcile();
    expect(response.body.attempted).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('isolates one provider failure and continues reconciling other pending rows', async () => {
    const failedId = await seed();
    const healthyId = await seed();
    mock.fixtures.putRow(failedId, {
      status: 'awaiting_signature', signing_provider: 'documenso', signing_status: 'pending', signing_envelope_id: 'failed-env',
    });
    mock.fixtures.putRow(healthyId, {
      status: 'awaiting_signature', signing_provider: 'documenso', signing_status: 'pending', signing_envelope_id: 'healthy-env',
    });
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const href = String(url);
      if (href.endsWith('/envelope/failed-env')) return jsonResponse({ error: 'provider unavailable' }, 503);
      if (href.endsWith('/envelope/healthy-env')) return jsonResponse({ status: 'PENDING', envelopeItems: [] });
      throw new Error(`Unexpected URL ${href}`);
    });
    const response = await reconcile();
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
    expect(response.body.results.find((result) => result.submissionId === failedId).ok).toBe(false);
    expect(response.body.results.find((result) => result.submissionId === healthyId).ok).toBe(true);
    expect(mock.fixtures.getRow(healthyId).signing_status).toBe('pending');
  });
});
