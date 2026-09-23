import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mock.client,
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const sendHandler = (await import('../api/roa-submissions/send-for-signature.js')).default;
const refreshHandler = (await import('../api/roa-submissions/refresh.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    send(bytes) { this.bytes = bytes; return this; },
  };
}

function fakePdfBytes(marker) {
  return Buffer.from(`%PDF-1.4\n${marker}\n${'x'.repeat(600)}\n%%EOF`);
}

function makeJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'application/json' : null },
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
    async arrayBuffer() { return Buffer.from(JSON.stringify(payload)); },
  };
}

function makePdfResponse(bytes, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'application/pdf' : null },
    async json() { throw new Error('not json'); },
    async text() { return status >= 400 ? 'provider pdf failure' : ''; },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function makeProvider() {
  return {
    envelope: null,
    createCalls: 0,
    fieldCalls: 0,
    distributeCalls: 0,
    signedDownloads: 0,
    certificateDownloads: 0,
    auditDownloads: 0,
    loseCreateResponseOnce: false,
    failAuditOnce: false,
    lastCreatePayload: null,
    signedBytes: Buffer.from('%PDF-1.4\nDOCUMENSO-SIGNED\n%%EOF'),
    certificateBytes: Buffer.from('%PDF-1.4\nDOCUMENSO-CERTIFICATE\n%%EOF'),
    auditBytes: Buffer.from('%PDF-1.4\nDOCUMENSO-AUDIT\n%%EOF'),
  };
}

let provider;

function installProviderFetch() {
  vi.spyOn(global, 'fetch').mockImplementation(async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method || 'GET').toUpperCase();
    const path = url.pathname;

    if (method === 'GET' && path.endsWith('/envelope')) {
      const query = url.searchParams.get('query');
      const data = provider.envelope && provider.envelope.externalId === query
        ? [{
            id: provider.envelope.id,
            externalId: provider.envelope.externalId,
            status: provider.envelope.status,
            title: provider.envelope.title,
          }]
        : [];
      return makeJsonResponse({ data, count: data.length, currentPage: 1, totalPages: data.length ? 1 : 0 });
    }

    if (method === 'POST' && path.endsWith('/envelope/create')) {
      provider.createCalls += 1;
      const payload = JSON.parse(options.body.get('payload'));
      provider.lastCreatePayload = payload;

      provider.envelope = {
        id: 'envelope-roa-1',
        externalId: payload.externalId,
        status: 'DRAFT',
        title: payload.title,
        completedAt: null,
        recipients: payload.recipients.map((recipient, index) => ({
          id: 100 + index + 1,
          ...recipient,
        })),
        fields: [],
        envelopeItems: [{ id: 'item-roa-1', title: `${payload.externalId}-canonical.pdf` }],
      };

      if (provider.loseCreateResponseOnce) {
        provider.loseCreateResponseOnce = false;
        throw new Error('socket closed after Documenso committed');
      }

      return makeJsonResponse({ id: provider.envelope.id });
    }

    if (method === 'GET' && path.endsWith('/envelope/envelope-roa-1')) {
      return makeJsonResponse(provider.envelope);
    }

    if (method === 'POST' && path.endsWith('/envelope/field/create-many')) {
      provider.fieldCalls += 1;
      const body = JSON.parse(options.body);
      provider.envelope.fields = body.data.map((field, index) => ({
        id: 200 + index + 1,
        envelopeId: provider.envelope.id,
        ...field,
      }));
      return makeJsonResponse({ data: provider.envelope.fields });
    }

    if (method === 'POST' && path.endsWith('/envelope/distribute')) {
      provider.distributeCalls += 1;
      provider.envelope.status = 'PENDING';
      return makeJsonResponse({
        success: true,
        id: provider.envelope.id,
        recipients: provider.envelope.recipients,
      });
    }

    if (
      method === 'GET'
      && path.endsWith('/envelope/item/item-roa-1/download')
      && url.searchParams.get('version') === 'signed'
    ) {
      provider.signedDownloads += 1;
      return makePdfResponse(provider.signedBytes);
    }

    if (method === 'GET' && path.endsWith('/envelope/envelope-roa-1/certificate/download')) {
      provider.certificateDownloads += 1;
      return makePdfResponse(provider.certificateBytes);
    }

    if (method === 'GET' && path.endsWith('/envelope/envelope-roa-1/audit-log/download')) {
      provider.auditDownloads += 1;
      if (provider.failAuditOnce) {
        provider.failAuditOnce = false;
        return makePdfResponse(Buffer.from(''), 502);
      }
      return makePdfResponse(provider.auditBytes);
    }

    throw new Error(`Unexpected Documenso request: ${method} ${url}`);
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.DOCUMENSO_API_URL = 'https://sign.example.test/api/v2';
  process.env.DOCUMENSO_API_TOKEN = 'api_documenso_test';

  _resetServerSupabaseForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});

  mock.fixtures.addAuthUser('token-andrew', {
    id: 'user-andrew',
    email: 'andrew@hrsinsurance.co.za',
  });
  mock.fixtures.addAuthUser('token-werner', {
    id: 'user-werner',
    email: 'werner@hrsinsurance.co.za',
  });

  provider = makeProvider();
  installProviderFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

async function seedSubmission(token = 'token-andrew') {
  const submissionId = generateSubmissionId();
  const res = mockRes();

  await createHandler({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      submissionId,
      roaType: 'Personal',
      snapshot: {
        firstName: 'Jane',
        surname: 'Doe',
        email: 'jane@example.com',
        brokerName: 'Andrew Penney',
      },
      versions: {
        templateVersion: 'T',
        statutoryDisclosureVersion: 'S',
        brokerAppointmentVersion: 'A',
        brokerFeeVersion: 'F',
      },
      pdfBase64: fakePdfBytes(submissionId).toString('base64'),
    },
  }, res);

  expect(res.statusCode).toBe(200);
  return submissionId;
}

async function send(submissionId, token = 'token-andrew') {
  const res = mockRes();
  await sendHandler({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: {
      submissionId,
      signerName: 'Jane Doe',
      signerEmail: 'jane@example.com',
      subject: 'Please sign your ROA',
      message: 'Please review and sign.',
    },
  }, res);
  return res;
}

async function refresh(submissionId, token = 'token-andrew') {
  const res = mockRes();
  await refreshHandler({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: { submissionId },
  }, res);
  return res;
}

describe('Documenso send flow', () => {
  it('creates one envelope per ROA with sequential client → broker signing', async () => {
    const id = await seedSubmission();

    const first = await send(id);
    expect(first.statusCode).toBe(200);
    expect(first.body.provider).toBe('documenso');
    expect(first.body.alreadySent).toBe(false);
    expect(first.body.envelopeId).toBe('envelope-roa-1');
    expect(first.body.status).toBe('pending');

    expect(provider.createCalls).toBe(1);
    expect(provider.fieldCalls).toBe(1);
    expect(provider.distributeCalls).toBe(1);
    expect(provider.lastCreatePayload.externalId).toBe(id);
    expect(provider.lastCreatePayload.meta.signingOrder).toBe('SEQUENTIAL');
    expect(provider.lastCreatePayload.recipients).toEqual([
      expect.objectContaining({
        email: 'jane@example.com',
        role: 'SIGNER',
        signingOrder: 1,
      }),
      expect.objectContaining({
        email: 'andrew@hrsinsurance.co.za',
        role: 'SIGNER',
        signingOrder: 2,
      }),
    ]);
    expect(provider.envelope.fields).toHaveLength(4);

    const row = mock.fixtures.getRow(id);
    expect(row.signature_provider).toBe('documenso');
    expect(row.signature_envelope_id).toBe('envelope-roa-1');
    expect(row.signature_status).toBe('pending');
    expect(row.status).toBe('awaiting_signature');

    const second = await send(id);
    expect(second.statusCode).toBe(200);
    expect(second.body.alreadySent).toBe(true);
    expect(second.body.envelopeId).toBe('envelope-roa-1');
    expect(provider.createCalls).toBe(1);
    expect(provider.fieldCalls).toBe(1);
    expect(provider.distributeCalls).toBe(1);
  });

  it('recovers the same envelope when the create response is lost', async () => {
    const id = await seedSubmission();
    provider.loseCreateResponseOnce = true;

    const result = await send(id);

    expect(result.statusCode).toBe(200);
    expect(result.body.envelopeId).toBe('envelope-roa-1');
    expect(provider.createCalls).toBe(1);
    expect(provider.envelope.externalId).toBe(id);

    const row = mock.fixtures.getRow(id);
    expect(row.signature_envelope_id).toBe('envelope-roa-1');
    expect(row.status).toBe('awaiting_signature');
  });

  it('keeps cross-broker send isolated', async () => {
    const id = await seedSubmission();
    const result = await send(id, 'token-werner');
    expect(result.statusCode).toBe(404);
    expect(provider.createCalls).toBe(0);
  });
});

describe('Documenso completion evidence', () => {
  it('retains signed PDF + certificate + audit log and hashes all three', async () => {
    const id = await seedSubmission();
    await send(id);

    provider.envelope.status = 'COMPLETED';
    provider.envelope.completedAt = '2026-09-23T10:00:00.000Z';

    const result = await refresh(id);
    expect(result.statusCode).toBe(200);
    expect(result.body.observedStatus).toBe('completed');
    expect(result.body.evidenceErrors).toBeUndefined();

    const row = mock.fixtures.getRow(id);
    expect(row.status).toBe('completed');
    expect(row.signature_status).toBe('completed');
    expect(row.completed_at).toBe('2026-09-23T10:00:00.000Z');
    expect(row.signed_pdf_storage_path).toBe(`${id}/signed.pdf`);
    expect(row.certificate_storage_path).toBe(`${id}/certificate.pdf`);
    expect(row.audit_log_storage_path).toBe(`${id}/audit.pdf`);
    expect(row.signed_pdf_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.certificate_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.audit_log_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.evidence_retrieved_at).toBeDefined();

    expect(mock.fixtures.getStorage(`${id}/signed.pdf`).equals(provider.signedBytes)).toBe(true);
    expect(mock.fixtures.getStorage(`${id}/certificate.pdf`).equals(provider.certificateBytes)).toBe(true);
    expect(mock.fixtures.getStorage(`${id}/audit.pdf`).equals(provider.auditBytes)).toBe(true);
  });

  it('retries only missing evidence after a partial audit retrieval failure', async () => {
    const id = await seedSubmission();
    await send(id);

    provider.envelope.status = 'COMPLETED';
    provider.envelope.completedAt = '2026-09-23T10:15:00.000Z';
    provider.failAuditOnce = true;

    const first = await refresh(id);
    expect(first.statusCode).toBe(200);
    expect(first.body.evidenceErrors).toEqual(['audit']);

    const row1 = mock.fixtures.getRow(id);
    expect(row1.signed_pdf_storage_path).toBe(`${id}/signed.pdf`);
    expect(row1.certificate_storage_path).toBe(`${id}/certificate.pdf`);
    expect(row1.audit_log_storage_path).toBeUndefined();
    expect(row1.evidence_retrieved_at).toBeUndefined();

    const second = await refresh(id);
    expect(second.statusCode).toBe(200);
    expect(second.body.evidenceErrors).toBeUndefined();

    const row2 = mock.fixtures.getRow(id);
    expect(row2.audit_log_storage_path).toBe(`${id}/audit.pdf`);
    expect(row2.evidence_retrieved_at).toBeDefined();
    expect(provider.signedDownloads).toBe(1);
    expect(provider.certificateDownloads).toBe(1);
    expect(provider.auditDownloads).toBe(2);
  });

  it.each([
    ['REJECTED', 'declined'],
    ['CANCELLED', 'voided'],
  ])('%s is terminal but never sets completed_at', async (providerState, localState) => {
    const id = await seedSubmission();
    await send(id);

    provider.envelope.status = providerState;
    const result = await refresh(id);

    expect(result.statusCode).toBe(200);
    const row = mock.fixtures.getRow(id);
    expect(row.status).toBe(localState);
    expect(row.completed_at ?? null).toBeNull();
    expect(row.signed_pdf_storage_path).toBeUndefined();
  });
});
