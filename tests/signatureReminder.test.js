import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';
import {
  REMINDER_COOLDOWN_MS,
  canOfferSignatureReminder,
  reminderBlockReason,
  reminderCooldownSeconds,
  signatureReminderErrorMessage,
} from '../src/lib/signatureReminder.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));
vi.mock('../api/_lib/docusignJwt.js', () => ({ getDocusignAccessToken: vi.fn(async () => 'unused') }));
vi.mock('../api/_lib/docusignAccount.js', () => ({
  resolveDocusignAccountBaseUrl: vi.fn(async () => ({ baseUrl: 'https://unused.test' })),
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const sendHandler = (await import('../api/roa-submissions/send-for-signature.js')).default;
const reminderHandler = (await import('../api/roa-submissions/send-reminder.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };
let fetchQueue;
let fetchCalls;

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

function envelope({ status = 'PENDING', clientStatus = 'NOT_SIGNED' } = {}) {
  return {
    id: 'doc-env-1',
    status,
    envelopeItems: [{ id: 'item-1' }],
    fields: [{ type: 'SIGNATURE' }, { type: 'DATE' }, { type: 'SIGNATURE' }, { type: 'DATE' }],
    recipients: [
      { id: 11, email: 'jane@example.com', signingOrder: 1, signingStatus: clientStatus },
      { id: 12, email: 'andrew@hrsinsurance.co.za', signingOrder: 2, signingStatus: 'NOT_SIGNED' },
    ],
  };
}

async function seedSent() {
  const submissionId = generateSubmissionId();
  const r = res();
  await createHandler({
    method: 'POST',
    headers: { authorization: 'Bearer token-andrew' },
    body: {
      submissionId,
      roaType: 'Personal',
      snapshot: { title: 'Ms', firstName: 'Jane', surname: 'Doe', email: 'jane@example.com', brokerName: 'Andrew Penney' },
      versions: {
        templateVersion: 'T', statutoryDisclosureVersion: 'S',
        brokerAppointmentVersion: 'A', brokerFeeVersion: 'F',
      },
      pdfBase64: Buffer.from(`%PDF-1.4\n${submissionId}\n${'x'.repeat(600)}\n%%EOF`).toString('base64'),
    },
  }, r);
  expect(r.statusCode).toBe(200);
  fetchQueue.push(jsonResponse({ id: 'doc-env-1' }));
  fetchQueue.push(jsonResponse(envelope()));
  const sent = res();
  await sendHandler({
    method: 'POST', headers: { authorization: 'Bearer token-andrew' }, body: { submissionId },
  }, sent);
  expect(sent.statusCode).toBe(200);
  fetchCalls.length = 0;
  return submissionId;
}

async function remind(submissionId, token = 'token-andrew') {
  const r = res();
  await reminderHandler({
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { submissionId },
  }, r);
  return r;
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.ROA_SIGNING_PROVIDER = 'documenso';
  process.env.DOCUMENSO_BASE_URL = 'https://sign.example.test';
  process.env.DOCUMENSO_API_TOKEN = 'api-test';
  _resetServerSupabaseForTests();
  mock.fixtures.addAuthUser('token-andrew', { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
  mock.fixtures.addAuthUser('token-werner', { id: 'user-werner', email: 'werner@hrsinsurance.co.za' });
  fetchQueue = [];
  fetchCalls = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    if (!fetchQueue.length) throw new Error(`unscripted fetch: ${url}`);
    return fetchQueue.shift();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  mock.fixtures.reset();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

describe('Documenso signature reminder endpoint', () => {
  it('redistributes the EXISTING envelope to the client only, without creating an envelope', async () => {
    const id = await seedSent();
    fetchQueue.push(jsonResponse(envelope()));
    fetchQueue.push(jsonResponse({ id: 'doc-env-1', recipients: [] }));

    const response = await remind(id);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, provider: 'documenso' });
    expect(response.body.submission.reminderCount).toBe(1);
    expect(response.body.submission.lastReminderAt).toBe(response.body.reminderSentAt);

    expect(fetchCalls.map((c) => `${c.options.method} ${c.url}`)).toEqual([
      'GET https://sign.example.test/api/v2/envelope/doc-env-1',
      'POST https://sign.example.test/api/v2/envelope/redistribute',
    ]);
    expect(JSON.parse(fetchCalls[1].options.body)).toEqual({ envelopeId: 'doc-env-1', recipients: [11] });
    expect(fetchCalls.some((c) => c.url.includes('/envelope/create'))).toBe(false);

    const row = mock.fixtures.getRow(id);
    expect(row.status).toBe('awaiting_signature');
    expect(row.signing_envelope_id).toBe('doc-env-1');
    expect(row.signing_meta).toMatchObject({ externalId: id, reminderCount: 1 });
  });

  it('leaves the idempotent send path untouched: a later send still returns alreadySent', async () => {
    const id = await seedSent();
    fetchQueue.push(jsonResponse(envelope()));
    fetchQueue.push(jsonResponse({ id: 'doc-env-1' }));
    expect((await remind(id)).statusCode).toBe(200);
    fetchCalls.length = 0;

    const again = res();
    await sendHandler({
      method: 'POST', headers: { authorization: 'Bearer token-andrew' }, body: { submissionId: id },
    }, again);
    expect(again.statusCode).toBe(200);
    expect(again.body).toMatchObject({ alreadySent: true, envelopeId: 'doc-env-1' });
    expect(fetchCalls).toHaveLength(0);
  });

  it('rate-limits repeat reminders without calling the provider', async () => {
    const id = await seedSent();
    fetchQueue.push(jsonResponse(envelope()));
    fetchQueue.push(jsonResponse({ id: 'doc-env-1' }));
    expect((await remind(id)).statusCode).toBe(200);
    fetchCalls.length = 0;

    const second = await remind(id);
    expect(second.statusCode).toBe(429);
    expect(second.body.error).toBe('reminder_too_soon');
    expect(second.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(fetchCalls).toHaveLength(0);
    expect(mock.fixtures.getRow(id).signing_meta.reminderCount).toBe(1);
  });

  it('allows another reminder once the cooldown has elapsed', async () => {
    const id = await seedSent();
    const old = new Date(Date.now() - REMINDER_COOLDOWN_MS - 1000).toISOString();
    mock.fixtures.putRow(id, { signing_meta: { externalId: id, lastReminderAt: old, reminderCount: 2 } });
    fetchQueue.push(jsonResponse(envelope()));
    fetchQueue.push(jsonResponse({ id: 'doc-env-1' }));
    const response = await remind(id);
    expect(response.statusCode).toBe(200);
    expect(mock.fixtures.getRow(id).signing_meta.reminderCount).toBe(3);
  });

  it.each([
    ['completed', { status: 'completed', signing_status: 'completed' }, 'signature_completed'],
    ['declined', { status: 'declined', signing_status: 'rejected' }, 'signature_declined'],
    ['voided', { status: 'voided', signing_status: 'cancelled' }, 'signature_voided'],
    ['expired', { status: 'expired', signing_status: 'expired' }, 'signature_expired'],
    ['signature_failed', { status: 'signature_failed', signing_status: 'failed' }, 'not_awaiting_signature'],
    ['draft (not distributed)', { signing_status: 'draft' }, 'not_awaiting_signature'],
  ])('refuses a %s submission without any provider call', async (_name, patch, code) => {
    const id = await seedSent();
    mock.fixtures.putRow(id, patch);
    const response = await remind(id);
    expect(response.statusCode).toBe(409);
    expect(response.body.error).toBe(code);
    expect(fetchCalls).toHaveLength(0);
  });

  it('refuses a submission that was never sent for signature', async () => {
    const submissionId = generateSubmissionId();
    await createHandler({
      method: 'POST',
      headers: { authorization: 'Bearer token-andrew' },
      body: {
        submissionId, roaType: 'Personal',
        snapshot: { firstName: 'Jane', surname: 'Doe', email: 'jane@example.com' },
        versions: { templateVersion: 'T', statutoryDisclosureVersion: 'S', brokerAppointmentVersion: 'A', brokerFeeVersion: 'F' },
        pdfBase64: Buffer.from(`%PDF-1.4\n${'x'.repeat(600)}\n%%EOF`).toString('base64'),
      },
    }, res());
    const response = await remind(submissionId);
    expect(response.statusCode).toBe(409);
    expect(response.body.error).toBe('no_signature_request');
    expect(fetchCalls).toHaveLength(0);
  });

  it('refuses non-Documenso providers (no DocuSign resend workflow)', async () => {
    const id = await seedSent();
    mock.fixtures.putRow(id, { signing_provider: 'docusign' });
    const response = await remind(id);
    expect(response.statusCode).toBe(409);
    expect(response.body.error).toBe('reminder_not_supported');
    expect(fetchCalls).toHaveLength(0);
  });

  it('trusts the live provider over a stale local status', async () => {
    const id = await seedSent();
    fetchQueue.push(jsonResponse(envelope({ status: 'COMPLETED' })));
    const completed = await remind(id);
    expect(completed.statusCode).toBe(409);
    expect(completed.body.error).toBe('signature_completed');

    fetchQueue.push(jsonResponse(envelope({ status: 'REJECTED' })));
    expect((await remind(id)).body.error).toBe('signature_declined');

    fetchQueue.push(jsonResponse(envelope({ status: 'CANCELLED' })));
    expect((await remind(id)).body.error).toBe('signature_voided');

    expect(fetchCalls.every((c) => !c.url.includes('redistribute'))).toBe(true);
    expect(mock.fixtures.getRow(id).signing_meta.reminderCount).toBeUndefined();
  });

  it('does not nudge the broker: a client who already signed gets no reminder', async () => {
    const id = await seedSent();
    fetchQueue.push(jsonResponse(envelope({ clientStatus: 'SIGNED' })));
    const response = await remind(id);
    expect(response.statusCode).toBe(409);
    expect(response.body.error).toBe('client_already_signed');
    expect(fetchCalls.every((c) => !c.url.includes('redistribute'))).toBe(true);
  });

  it('surfaces a provider failure safely and does not record a reminder', async () => {
    const id = await seedSent();
    fetchQueue.push(jsonResponse(envelope()));
    fetchQueue.push(jsonResponse({ message: 'boom' }, 500));
    const response = await remind(id);
    expect(response.statusCode).toBe(502);
    expect(response.body.error).toBe('reminder_failed');
    expect(mock.fixtures.getRow(id).signing_meta.lastReminderAt).toBeUndefined();
  });

  it('is broker-scoped and authenticated', async () => {
    const id = await seedSent();
    const other = await remind(id, 'token-werner');
    expect(other.statusCode).toBe(404);
    const anon = res();
    await reminderHandler({ method: 'POST', headers: {}, body: { submissionId: id } }, anon);
    expect(anon.statusCode).toBe(401);
    const wrongMethod = res();
    await reminderHandler({ method: 'GET', headers: { authorization: 'Bearer token-andrew' } }, wrongMethod);
    expect(wrongMethod.statusCode).toBe(405);
    const invalid = res();
    await reminderHandler({
      method: 'POST', headers: { authorization: 'Bearer token-andrew' }, body: { submissionId: 'nope' },
    }, invalid);
    expect(invalid.statusCode).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('reminder eligibility (shared by UI and server)', () => {
  const base = { provider: 'documenso', hasEnvelope: true, status: 'awaiting_signature', signingStatus: 'pending' };

  it('is offered only while the client can still sign', () => {
    expect(reminderBlockReason(base)).toBeNull();
    expect(reminderBlockReason({ ...base, signingStatus: 'sent' })).toBeNull();
    expect(reminderBlockReason({ ...base, signingStatus: 'delivered' })).toBeNull();
    for (const [patch, code] of [
      [{ hasEnvelope: false }, 'no_signature_request'],
      [{ provider: 'docusign' }, 'reminder_not_supported'],
      [{ status: 'completed', signingStatus: 'completed' }, 'signature_completed'],
      [{ status: 'declined' }, 'signature_declined'],
      [{ status: 'voided' }, 'signature_voided'],
      [{ status: 'expired' }, 'signature_expired'],
      [{ status: 'submitted' }, 'not_awaiting_signature'],
      [{ signingStatus: null }, 'not_awaiting_signature'],
    ]) {
      expect(reminderBlockReason({ ...base, ...patch })).toBe(code);
    }
  });

  it('gates the UI on the broker-facing submission view', () => {
    const view = { signingProvider: 'documenso', signingEnvelopeId: 'e', status: 'awaiting_signature', signingStatus: 'pending' };
    expect(canOfferSignatureReminder(view)).toBe(true);
    expect(canOfferSignatureReminder({ ...view, status: 'completed', signingStatus: 'completed' })).toBe(false);
    expect(canOfferSignatureReminder({ ...view, signingEnvelopeId: null })).toBe(false);
    expect(canOfferSignatureReminder(null)).toBe(false);
  });

  it('computes the cooldown and has a message for every code', () => {
    const now = Date.parse('2026-10-05T10:00:00Z');
    expect(reminderCooldownSeconds(null, now)).toBe(0);
    expect(reminderCooldownSeconds('2026-10-05T09:58:00Z', now)).toBe(180);
    expect(reminderCooldownSeconds('2026-10-05T09:50:00Z', now)).toBe(0);
    for (const code of [
      'no_signature_request', 'reminder_not_supported', 'signature_completed', 'signature_declined',
      'signature_voided', 'signature_expired', 'not_awaiting_signature', 'client_already_signed',
      'signature_request_not_active', 'reminder_too_soon', 'reminder_failed',
    ]) {
      expect(signatureReminderErrorMessage(code)).not.toBe(signatureReminderErrorMessage('unknown'));
    }
  });
});
