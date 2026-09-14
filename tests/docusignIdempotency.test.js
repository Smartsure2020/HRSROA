// DocuSign envelope idempotency (Phase ROA-1 §15, §28).
//
// The atomic reserveEnvelopeSlot + row update guarantees that concurrent Send
// requests never produce more than one envelope for the same submission, and
// that the same client can safely retry after a page refresh.
//
// The dev-mock path is used everywhere here (no DOCUSIGN_INTEGRATION_KEY),
// so the endpoint never talks to DocuSign. Real DocuSign HTTP is exercised
// by the completion test with an injected fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mock.client,
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const sendHandler = (await import('../api/roa-submissions/send-for-signature.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader() { return this; },
    send() { return this; },
  };
}

function fakePdfBytes(marker) {
  return Buffer.from(`%PDF-1.4\n${marker}\n${'x'.repeat(600)}\n%%EOF`);
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.DOCUSIGN_ENVIRONMENT = 'sandbox';
  delete process.env.DOCUSIGN_INTEGRATION_KEY; // dev-mock path
  _resetServerSupabaseForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
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
        snapshot: { firstName: 'Jane', surname: 'Doe', brokerName: 'Andrew Penney' },
        versions: {
          templateVersion: 'HRS-TEMPLATE-2026-01',
          statutoryDisclosureVersion: 'HRS-STAT-DISC-2026-01',
          brokerAppointmentVersion: 'HRS-BROKER-APPT-2026-01',
          brokerFeeVersion: 'HRS-BROKER-FEE-2026-01',
        },
        pdfBase64: fakePdfBytes(submissionId).toString('base64'),
      },
    },
    res,
  );
  if (res.statusCode !== 200) throw new Error(`seed failed: ${JSON.stringify(res.body)}`);
  return submissionId;
}

async function send(token, submissionId) {
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

describe('send-for-signature — idempotency', () => {
  it('first send creates an envelope', async () => {
    const id = await seedSubmission();
    const r1 = await send('token-andrew', id);
    expect(r1.statusCode).toBe(200);
    expect(r1.body.envelopeId).toMatch(/^dev-mock-/);
    expect(r1.body.status).toBe('sent');
    expect(r1.body.submission.docusignEnvelopeId).toBe(r1.body.envelopeId);
  });

  it('second send for the same submission returns the SAME envelope', async () => {
    const id = await seedSubmission();
    const r1 = await send('token-andrew', id);
    const r2 = await send('token-andrew', id);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r2.body.alreadySent).toBe(true);
    expect(r2.body.envelopeId).toBe(r1.body.envelopeId);

    // Only one envelope id ever landed on the row.
    const row = mock.fixtures.getRow(id);
    expect(row.docusign_envelope_id).toBe(r1.body.envelopeId);
  });

  it('different submissions produce different envelopes', async () => {
    const a = await seedSubmission();
    const b = await seedSubmission();
    const ra = await send('token-andrew', a);
    const rb = await send('token-andrew', b);
    expect(ra.body.envelopeId).not.toBe(rb.body.envelopeId);
  });

  it('cross-broker send → 404 (does not touch the submission)', async () => {
    const id = await seedSubmission('token-andrew');
    const r = await send('token-werner', id);
    expect(r.statusCode).toBe(404);
    const row = mock.fixtures.getRow(id);
    expect(row.docusign_envelope_id).toBeUndefined();
  });

  it('unknown submissionId → 404', async () => {
    const r = await send('token-andrew', 'ROA-11111111-2222-3333-4444-555555555555');
    expect(r.statusCode).toBe(404);
  });

  it('unauthenticated → 401 without side effects', async () => {
    const id = await seedSubmission();
    const res = mockRes();
    await sendHandler(
      {
        method: 'POST',
        headers: {},
        body: { submissionId: id, signerName: 'X', signerEmail: 'x@y' },
      },
      res,
    );
    expect(res.statusCode).toBe(401);
    const row = mock.fixtures.getRow(id);
    expect(row.docusign_envelope_id).toBeUndefined();
  });
});
