import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));
vi.mock('../api/_lib/docusignJwt.js', () => ({
  getDocusignAccessToken: vi.fn(async () => 'mock-access-token'),
}));
vi.mock('../api/_lib/docusignAccount.js', () => ({
  resolveDocusignAccountBaseUrl: vi.fn(async () => ({ baseUrl: 'https://na99.docusign.net/restapi' })),
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const sendHandler = (await import('../api/roa-submissions/send-for-signature.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };
let script = [];

function res() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader() { return this; }, send() { return this; },
  };
}
function pdfBytes(marker) {
  return Buffer.from(`%PDF-1.4\n${marker}\n${'x'.repeat(600)}\n%%EOF`);
}
function jsonResponse(payload, ok = true, status = ok ? 200 : 500) {
  return { ok, status, async json() { return payload; }, async text() { return JSON.stringify(payload); } };
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
  mock.fixtures.addAuthUser('token-andrew', { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  script = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (...args) => {
    if (!script.length) throw new Error('unscripted fetch');
    const next = script.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(...args);
    return next;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
  Object.assign(process.env, originalEnv);
});

async function seed() {
  const id = generateSubmissionId();
  const r = res();
  await createHandler({
    method: 'POST',
    headers: { authorization: 'Bearer token-andrew' },
    body: {
      submissionId: id,
      roaType: 'Personal',
      snapshot: { firstName: 'Jane', surname: 'Doe', brokerName: 'Andrew Penney' },
      versions: { templateVersion: 'T', statutoryDisclosureVersion: 'S', brokerAppointmentVersion: 'A', brokerFeeVersion: 'F' },
      pdfBase64: pdfBytes(id).toString('base64'),
    },
  }, r);
  expect(r.statusCode).toBe(200);
  return id;
}
async function send(id) {
  const r = res();
  await sendHandler({
    method: 'POST',
    headers: { authorization: 'Bearer token-andrew' },
    body: { submissionId: id, signerName: 'Jane Doe', signerEmail: 'jane@example.com' },
  }, r);
  return r;
}

describe('ROA-1.1 DocuSign ambiguous-send reconciliation', () => {
  it('includes transactionId and recovers the created envelope after a lost POST response', async () => {
    const id = await seed();
    let posted;
    script.push((_url, options) => {
      posted = JSON.parse(options.body);
      throw new Error('response lost after provider commit');
    });
    script.push(jsonResponse({ envelopes: [{ envelopeId: 'env-recovered', status: 'sent', transactionId: id }] }));

    const first = await send(id);
    expect(posted.transactionId).toBe(id);
    expect(first.statusCode).toBe(200);
    expect(first.body.recovered).toBe(true);
    expect(first.body.envelopeId).toBe('env-recovered');

    const second = await send(id);
    expect(second.statusCode).toBe(200);
    expect(second.body.alreadySent).toBe(true);
    expect(second.body.envelopeId).toBe('env-recovered');
  });

  it('does not unlock an ambiguous send while transaction lookup is unavailable', async () => {
    const id = await seed();
    script.push(new Error('POST response lost'));
    script.push(new Error('lookup unavailable'));

    const first = await send(id);
    expect(first.statusCode).toBe(503);
    expect(first.body.error).toBe('docusign_send_ambiguous');
    expect(mock.fixtures.getRow(id).status).toBe('awaiting_signature');

    script.push(jsonResponse({ envelopes: [{ envelopeId: 'env-late', status: 'sent', transactionId: id }] }));
    const retry = await send(id);
    expect(retry.statusCode).toBe(200);
    expect(retry.body.recovered).toBe(true);
    expect(retry.body.envelopeId).toBe('env-late');
  });

  it('releases the reservation only after lookup confirms absence', async () => {
    const id = await seed();
    script.push(new Error('POST response lost'));
    script.push(jsonResponse({ envelopes: [] }));

    const first = await send(id);
    expect(first.statusCode).toBe(503);
    expect(first.body.error).toBe('docusign_send_unconfirmed');
    expect(first.body.retryable).toBe(true);
    expect(mock.fixtures.getRow(id).status).toBe('signature_failed');
  });
});
