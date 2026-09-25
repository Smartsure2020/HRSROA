import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';
import { sha256HexOfBytes } from '../api/_lib/sha256.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));
vi.mock('../api/_lib/docusignJwt.js', () => ({
  getDocusignAccessToken: vi.fn(async () => 'unused'),
}));
vi.mock('../api/_lib/docusignAccount.js', () => ({
  resolveDocusignAccountBaseUrl: vi.fn(async () => ({ baseUrl: 'https://unused.test' })),
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const sendModule = await import('../api/roa-submissions/send-for-signature.js');
const sendHandler = sendModule.default;
const { signerForSubmission } = sendModule;
const refreshHandler = (await import('../api/roa-submissions/refresh.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };
let fetchQueue;

function res() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader() { return this; },
    send() { return this; },
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

function pdfResponse(bytes) {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function preparedEnvelope(id = 'doc-env-1') {
  return {
    id,
    status: 'PENDING',
    envelopeItems: [{ id: 'item-1' }],
    fields: [
      { type: 'SIGNATURE' },
      { type: 'DATE' },
      { type: 'SIGNATURE' },
      { type: 'DATE' },
    ],
  };
}

async function seedSubmission(snapshot = {}) {
  const submissionId = generateSubmissionId();
  const response = res();
  const pdfBytes = Buffer.from(`%PDF-1.4\n${submissionId}\n${'x'.repeat(600)}\n%%EOF`);
  await createHandler({
    method: 'POST',
    headers: { authorization: 'Bearer token-andrew' },
    body: {
      submissionId,
      roaType: 'Personal',
      snapshot: {
        title: 'Ms',
        firstName: 'Jane',
        surname: 'Doe',
        email: 'jane@example.com',
        brokerName: 'Andrew Penney',
        ...snapshot,
      },
      versions: {
        templateVersion: 'T',
        statutoryDisclosureVersion: 'S',
        brokerAppointmentVersion: 'A',
        brokerFeeVersion: 'F',
      },
      pdfBase64: pdfBytes.toString('base64'),
    },
  }, response);
  expect(response.statusCode).toBe(200);
  return submissionId;
}

async function send(submissionId, body = {}) {
  const response = res();
  await sendHandler({
    method: 'POST',
    headers: { authorization: 'Bearer token-andrew' },
    body: { submissionId, ...body },
  }, response);
  return response;
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.ROA_SIGNING_PROVIDER = 'documenso';
  process.env.DOCUMENSO_BASE_URL = 'https://sign.example.test';
  process.env.DOCUMENSO_API_TOKEN = 'api-test';
  _resetServerSupabaseForTests();
  mock.fixtures.addAuthUser('token-andrew', {
    id: 'user-andrew',
    email: 'andrew@hrsinsurance.co.za',
  });
  fetchQueue = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(global, 'fetch').mockImplementation(async (...args) => {
    if (!fetchQueue.length) throw new Error('fetch called with no scripted response');
    const next = fetchQueue.shift();
    return typeof next === 'function' ? next(...args) : next;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

describe('Documenso reliability after PR #3 reconciliation', () => {
  it('uses one frozen signer derivation for Personal and Commercial submissions', () => {
    expect(signerForSubmission({
      roa_type: 'Personal',
      snapshot_json: { title: 'Dr', firstName: 'Jane', surname: 'Doe', email: ' jane@example.com ' },
    })).toEqual({ signerName: 'Dr Jane Doe', signerEmail: 'jane@example.com' });
    expect(signerForSubmission({
      roa_type: 'Commercial',
      snapshot_json: { contactPerson: 'Alex Rivera', companyName: 'ACME', email: 'alex@acme.example' },
    })).toEqual({ signerName: 'Alex Rivera', signerEmail: 'alex@acme.example' });
    expect(signerForSubmission({ roa_type: 'Personal', snapshot_json: { firstName: 'No Email' } })).toBeNull();
  });

  it('sends the frozen signer and ignores caller-controlled identity and message fields', async () => {
    const id = await seedSubmission();
    let payload;
    fetchQueue.push((_url, options) => {
      payload = JSON.parse(options.body.get('payload'));
      return jsonResponse({ id: 'doc-env-bound' });
    });
    fetchQueue.push(jsonResponse(preparedEnvelope('doc-env-bound')));

    const response = await send(id, {
      signerName: 'Attacker',
      signerEmail: 'attacker@example.com',
      subject: 'Injected subject',
      message: 'Injected message',
    });

    expect(response.statusCode).toBe(200);
    expect(payload.externalId).toBe(id);
    expect(payload.recipients[0]).toMatchObject({
      name: 'Ms Jane Doe',
      email: 'jane@example.com',
      signingOrder: 1,
    });
    expect(payload.recipients[1]).toMatchObject({ signingOrder: 2 });
    expect(payload.meta.subject).not.toContain('Injected subject');
    expect(payload.meta.message).not.toContain('Injected message');
  });

  it('does not reconcile or release while another Documenso create is in flight', async () => {
    const id = await seedSubmission();
    let startCreate;
    let finishCreate;
    const createStarted = new Promise((resolve) => { startCreate = resolve; });
    const pendingCreate = new Promise((resolve) => { finishCreate = resolve; });
    fetchQueue.push(() => {
      startCreate();
      return pendingCreate;
    });
    fetchQueue.push(jsonResponse(preparedEnvelope('doc-env-original')));

    const firstSend = send(id);
    await createStarted;
    const concurrent = await send(id);

    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.body.error).toBe('send_in_progress');
    expect(mock.fixtures.getRow(id).status).toBe('awaiting_signature');
    expect(fetchQueue).toHaveLength(1);

    finishCreate(jsonResponse({ id: 'doc-env-original' }));
    const first = await firstSend;
    expect(first.statusCode).toBe(200);
    expect(first.body.envelopeId).toBe('doc-env-original');
  });

  it('keeps the reservation locked when a create result and reconciliation are ambiguous', async () => {
    const id = await seedSubmission();
    fetchQueue.push(jsonResponse({ error: 'provider uncertain' }, 500));
    fetchQueue.push(jsonResponse({ data: [] }));

    const first = await send(id);
    expect(first.statusCode).toBe(503);
    expect(first.body.error).toBe('documenso_send_ambiguous');
    expect(first.body.retryable).toBe(false);
    expect(mock.fixtures.getRow(id).status).toBe('awaiting_signature');

    const retry = await send(id);
    expect(retry.statusCode).toBe(409);
    expect(retry.body.error).toBe('send_in_progress');
    expect(fetchQueue).toHaveLength(0);
  });

  it('keeps an existing DocuSign submission on the fallback provider', async () => {
    const id = await seedSubmission();
    mock.fixtures.putRow(id, {
      status: 'awaiting_signature',
      signing_provider: 'docusign',
      docusign_envelope_id: 'env-existing',
      docusign_status: 'sent',
    });

    const response = await send(id);
    expect(response.statusCode).toBe(200);
    expect(response.body.envelopeId).toBe('env-existing');
    expect(fetchQueue).toHaveLength(0);
  });

  it('stores completion once and requires signed, certificate, and audit evidence', async () => {
    const id = await seedSubmission();
    const firstCompletion = '2026-09-25T08:00:00.000Z';
    mock.fixtures.putRow(id, {
      status: 'awaiting_signature',
      signing_provider: 'documenso',
      signing_envelope_id: 'doc-env-complete',
      signing_item_id: 'item-complete',
      signing_status: 'pending',
    });
    const signed = Buffer.from('%PDF signed');
    const certificate = Buffer.from('%PDF certificate');
    const audit = Buffer.from('%PDF audit');
    fetchQueue.push(jsonResponse({
      id: 'doc-env-complete',
      status: 'COMPLETED',
      completedAt: firstCompletion,
      envelopeItems: [{ id: 'item-complete' }],
    }));
    fetchQueue.push(pdfResponse(signed), pdfResponse(certificate), pdfResponse(audit));

    const first = res();
    await refreshHandler({
      method: 'POST',
      headers: { authorization: 'Bearer token-andrew' },
      body: { submissionId: id },
    }, first);

    expect(first.statusCode).toBe(200);
    let row = mock.fixtures.getRow(id);
    expect(row.status).toBe('completed');
    expect(row.completed_at).toBe(firstCompletion);
    expect(row.signed_pdf_sha256).toBe(sha256HexOfBytes(signed));
    expect(row.certificate_sha256).toBe(sha256HexOfBytes(certificate));
    expect(row.audit_log_sha256).toBe(sha256HexOfBytes(audit));
    expect(row.evidence_retrieved_at).toBeDefined();

    fetchQueue.push(jsonResponse({
      id: 'doc-env-complete',
      status: 'COMPLETED',
      completedAt: '2026-09-25T09:00:00.000Z',
      envelopeItems: [{ id: 'item-complete' }],
    }));
    const second = res();
    await refreshHandler({
      method: 'POST',
      headers: { authorization: 'Bearer token-andrew' },
      body: { submissionId: id },
    }, second);
    row = mock.fixtures.getRow(id);
    expect(row.completed_at).toBe(firstCompletion);
  });

  it('maps rejected and cancelled without setting completed_at', async () => {
    for (const [providerStatus, expectedStatus] of [['REJECTED', 'declined'], ['CANCELLED', 'voided']]) {
      const id = await seedSubmission();
      mock.fixtures.putRow(id, {
        status: 'awaiting_signature',
        signing_provider: 'documenso',
        signing_envelope_id: `doc-env-${providerStatus.toLowerCase()}`,
        signing_status: 'pending',
      });
      fetchQueue.push(jsonResponse({ status: providerStatus, envelopeItems: [] }));
      const response = res();
      await refreshHandler({
        method: 'POST',
        headers: { authorization: 'Bearer token-andrew' },
        body: { submissionId: id },
      }, response);
      const row = mock.fixtures.getRow(id);
      expect(row.status).toBe(expectedStatus);
      expect(row.completed_at ?? null).toBeNull();
    }
  });
});
