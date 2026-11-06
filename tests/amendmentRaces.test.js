// Amend ROA (Issue #8) — safety remediation: races, evidence retention, and the 404 trust gap.
//
// Everything here is deterministic. Concurrency is not left to timing: a test decides the exact
// instant another request "gets there first" (mock.fixtures.onUpdate runs just before a write
// lands; fake.override runs while a provider answer is being produced) and then asserts what the
// database and the provider look like afterwards. Offline: in-memory Supabase + stateful fake
// Documenso; nothing touches a network or production data.
//
//   R1  a completed ROA stays completed — a stale observation or cancellation cannot overwrite it
//   R2  a partially signed request is never withdrawn before its audit trail is safely kept
//   R3  a provider 404 is not proof of OUR cancellation unless the provider acknowledged our delete

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';
import { makeFakeDocumenso } from './testUtils/fakeDocumenso.js';
import { TEST_TOKENS } from './testUtils/testJwt.js';
import { sha256HexOfBytes } from '../api/_lib/sha256.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));
vi.mock('../api/_lib/docusignJwt.js', () => ({ getDocusignAccessToken: vi.fn(async () => 'mock-access-token') }));
vi.mock('../api/_lib/docusignAccount.js', () => ({
  resolveDocusignAccountBaseUrl: vi.fn(async () => ({ baseUrl: 'https://na99.docusign.net/restapi' })),
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const getHandler = (await import('../api/roa-submissions/get.js')).default;
const sendHandler = (await import('../api/roa-submissions/send-for-signature.js')).default;
const refreshHandler = (await import('../api/roa-submissions/refresh.js')).default;
const repo = await import('../api/_lib/submissionRepo.js');
const { reconcileSigningSubmission } = await import('../api/_lib/signingReconciliation.js');
const { providerAcknowledgedOurDelete } = await import('../api/_lib/documensoSigning.js');
const { AUDIT_BACKUP_MAX_ATTEMPTS, DELETE_IN_FLIGHT_GRACE_MS } = await import('../api/_lib/supersession.js');
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };
let fake;

const ANDREW = TEST_TOKENS.andrew;
const WERNER = TEST_TOKENS.werner;
const ANDREW_BROKER = { normalizedEmail: 'andrew@hrsinsurance.co.za', email: 'andrew@hrsinsurance.co.za' };
const WERNER_BROKER = { normalizedEmail: 'werner@hrsinsurance.co.za', email: 'werner@hrsinsurance.co.za' };

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send() { return this; },
  };
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });
const pdf = (marker) => Buffer.from(`%PDF-1.4\n${marker}\n${'x'.repeat(600)}\n%%EOF`, 'utf8');
const VERSIONS = {
  templateVersion: 'T-2026', statutoryDisclosureVersion: 'S-2026',
  brokerAppointmentVersion: 'A-2026', brokerFeeVersion: 'F-2026',
};
const PERSONAL = {
  title: 'Ms', firstName: 'Jane', surname: 'Doe', idNumber: '8001015009087',
  email: 'jane@example.com', brokerName: 'Andrew Penney', recInsurer: 'Stratsys',
};

function seedRevision1({ status = 'submitted', ...overrides } = {}) {
  const id = overrides.id ?? generateSubmissionId();
  const canonical = pdf(`canonical-${id}`);
  const row = {
    id,
    roa_type: 'Personal',
    status,
    advisor_user_id: '11111111-0000-4000-8000-0000000000a1',
    advisor_email: 'andrew@hrsinsurance.co.za',
    client_reference: 'Personal – Jane Doe',
    snapshot_json: PERSONAL,
    template_version: 't', statutory_disclosure_version: 's',
    broker_appointment_version: 'b', broker_fee_version: 'f',
    pdf_sha256: sha256HexOfBytes(canonical),
    pdf_storage_path: `${id}/canonical.pdf`,
    pdf_byte_length: canonical.length,
    submitted_at: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
  mock.fixtures.putStorage(row.pdf_storage_path, canonical);
  mock.fixtures.insertRow(row);
  return id;
}

/** What another request leaves behind once it has recorded a completion and its evidence. */
function finishRow(id, envelopeId) {
  const evidence = {};
  for (const [key, file] of [['signed', 'signed.pdf'], ['certificate', 'certificate.pdf'], ['audit_log', 'audit-log.pdf']]) {
    const bytes = pdf(`${key}-${id}`);
    mock.fixtures.putStorage(`${id}/${file}`, bytes);
    evidence[`${key}_storage_path`.replace('signed_storage', 'signed_pdf_storage')] = `${id}/${file}`;
    evidence[`${key}_sha256`.replace('signed_sha256', 'signed_pdf_sha256')] = sha256HexOfBytes(bytes);
  }
  mock.fixtures.putRow(id, {
    ...evidence,
    status: 'completed',
    signing_provider: 'documenso',
    signing_envelope_id: envelopeId,
    signing_status: 'completed',
    completed_at: '2026-10-29T09:00:00.000Z',
    evidence_retrieved_at: '2026-10-29T09:00:05.000Z',
  });
}

function sendRevision(id, { envelopeStatus = 'PENDING', envelopeId = 'env-p1', recipients } = {}) {
  fake.seedEnvelope({ id: envelopeId, externalId: id, status: envelopeStatus, ...(recipients ? { recipients } : {}) });
  mock.fixtures.putRow(id, {
    status: 'awaiting_signature',
    signing_provider: 'documenso',
    signing_envelope_id: envelopeId,
    signing_item_id: `item-${envelopeId}`,
    signing_status: envelopeStatus.toLowerCase(),
    signing_meta: { externalId: id },
    sent_for_signature_at: '2026-09-01T09:00:00.000Z',
  });
  return envelopeId;
}

async function amend({ from, submissionId = generateSubmissionId() }) {
  const res = mockRes();
  await createHandler({
    method: 'POST',
    headers: bearer(ANDREW),
    body: {
      submissionId,
      roaType: 'Personal',
      snapshot: { ...PERSONAL, email: 'jane.corrected@example.com' },
      versions: VERSIONS,
      pdfBase64: pdf(`revision-${submissionId}`).toString('base64'),
      amendment: { supersedesSubmissionId: from, reason: 'incorrect_email' },
    },
  }, res);
  expect(res.statusCode).toBe(200);
  return submissionId;
}

async function send(submissionId, token = ANDREW) {
  const res = mockRes();
  await sendHandler({ method: 'POST', headers: bearer(token), body: { submissionId } }, res);
  return res;
}

async function refresh(submissionId, token = ANDREW) {
  const res = mockRes();
  await refreshHandler({ method: 'POST', headers: bearer(token), body: { submissionId } }, res);
  return res;
}

/** The client view of a submission, exactly as the browser receives it. */
async function view(id, token = ANDREW) {
  const res = mockRes();
  await getHandler({ method: 'GET', headers: bearer(token), query: { id } }, res);
  return res.body.submission;
}

const rowOf = (id) => mock.fixtures.getRow(id);
/** Every column except CRM-filing bookkeeping and the write timestamp. */
const lifecycleOf = (row) => Object.fromEntries(
  Object.entries(row).filter(([key]) => !key.startsWith('crm_') && key !== 'updated_at'),
);
const created = () => fake.callsTo('POST', '/envelope/create');
const deletes = () => fake.callsTo('POST', '/envelope/delete');
const auditDownloads = () => fake.calls.filter((c) => c.method === 'GET' && /\/audit-log\/download$/.test(c.path));
const isAuditDownload = (c) => c.method === 'GET' && /\/audit-log\/download$/.test(c.path);
const isDelete = (c) => c.method === 'POST' && c.path === '/envelope/delete';
const isGet = (envelopeId) => (c) => c.method === 'GET' && c.path === `/envelope/${envelopeId}`;
const supersessionOf = (id) => rowOf(id).signing_meta?.supersession;

/** A pair: rev1 live at the provider, rev2 its (unsent) amendment. */
async function livePair({ partial = false, recipients, envelopeStatus = 'PENDING', envelopeId = 'env-p1' } = {}) {
  const rev1 = seedRevision1();
  sendRevision(rev1, { envelopeStatus, envelopeId, recipients });
  if (partial) fake.signRecipient(envelopeId, 1);
  const rev2 = await amend({ from: rev1 });
  return { rev1, rev2, envelopeId };
}

function expectUnsent(rev2) {
  expect(created()).toHaveLength(0);
  expect(rowOf(rev2).signing_envelope_id ?? null).toBeNull();
  expect(rowOf(rev2).status).toBe('submitted');
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.ROA_SIGNING_PROVIDER = 'documenso';
  process.env.DOCUMENSO_BASE_URL = 'https://sign.example.test';
  process.env.DOCUMENSO_API_TOKEN = 'api-test';
  delete process.env.CRM_BASE_URL;
  delete process.env.CRM_INTEGRATION_SECRET;
  _resetServerSupabaseForTests();
  mock.fixtures.reset();
  mock.fixtures.addAuthUser(ANDREW, { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
  mock.fixtures.addAuthUser(WERNER, { id: 'user-werner', email: 'werner@hrsinsurance.co.za' });
  fake = makeFakeDocumenso();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(global, 'fetch').mockImplementation((...args) => fake.fetch(...args));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

// =======================================================================================
describe('R1 — a completed ROA stays completed', () => {
  describe('a stale provider observation in the reconcile path', () => {
    it.each([
      ['PENDING', 'a stale "still pending" read'],
      ['CANCELLED', 'a stale "cancelled" read'],
      ['REJECTED', 'a stale "declined" read'],
    ])('%s: %s cannot overwrite a record that completed in the meantime', async (staleStatus) => {
      const rev1 = seedRevision1();
      const envelopeId = sendRevision(rev1);
      let completedRow;
      fake.override(isGet(envelopeId), () => {
        // The provider answers with what was true a moment ago…
        const stale = {
          id: envelopeId, status: staleStatus, externalId: rev1, completedAt: null,
          recipients: [], envelopeItems: [{ id: `item-${envelopeId}` }], fields: [],
        };
        // …while another request completes the ROA and records its evidence.
        finishRow(rev1, envelopeId);
        completedRow = rowOf(rev1);
        return fake.json(stale);
      });

      const res = await refresh(rev1);

      expect(res.statusCode).toBe(200);
      // Not one lifecycle or evidence column moved: status, signing_status, completion time and
      // evidence all stand. (CRM filing bookkeeping on a completed row is separate and expected.)
      expect(lifecycleOf(rowOf(rev1))).toEqual(lifecycleOf(completedRow));
      expect(res.body.submission).toMatchObject({ status: 'completed', hasSignedPdf: true, hasCertificate: true, hasAuditLog: true });
    });

    it('an observation never reopens a final record either: a stale COMPLETED read does not flip a request voided meanwhile', async () => {
      const rev1 = seedRevision1();
      const envelopeId = sendRevision(rev1);
      fake.override(isGet(envelopeId), () => {
        mock.fixtures.putRow(rev1, { status: 'voided', signing_status: 'cancelled' });
        return fake.json({
          id: envelopeId, status: 'COMPLETED', externalId: rev1, completedAt: '2026-10-29T09:00:00.000Z',
          recipients: [], envelopeItems: [{ id: `item-${envelopeId}` }], fields: [],
        });
      });
      const before = () => rowOf(rev1);
      await refresh(rev1);
      expect(before()).toMatchObject({ status: 'voided', signing_status: 'cancelled' });
      expect(before().completed_at ?? null).toBeNull();
    });

    it('still fills in missing evidence on a row that is already completed (retry after a failed download)', async () => {
      const rev1 = seedRevision1();
      const envelopeId = sendRevision(rev1);
      fake.complete(envelopeId);
      mock.fixtures.putRow(rev1, { status: 'completed', signing_status: 'completed', completed_at: '2026-10-29T09:00:00.000Z' });
      const res = await refresh(rev1);
      expect(res.statusCode).toBe(200);
      expect(rowOf(rev1)).toMatchObject({
        status: 'completed',
        signed_pdf_storage_path: `${rev1}/signed.pdf`,
        certificate_storage_path: `${rev1}/certificate.pdf`,
        audit_log_storage_path: `${rev1}/audit-log.pdf`,
      });
      expect(rowOf(rev1).evidence_retrieved_at).toBeTruthy();
    });
  });

  describe('a stale cancellation in the replacement gate', () => {
    it('provider says declined, but the ROA completed before that was recorded → completed wins, nothing sent', async () => {
      const { rev1, rev2, envelopeId } = await livePair({ envelopeStatus: 'REJECTED' });
      mock.fixtures.onUpdate((p) => p.status === 'declined', () => finishRow(rev1, envelopeId));

      const res = await send(rev2);

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_completed');
      expect(rowOf(rev1)).toMatchObject({ status: 'completed', signing_status: 'completed' });
      expect(rowOf(rev1).completed_at).toBe('2026-10-29T09:00:00.000Z');
      expect(rowOf(rev1).signed_pdf_storage_path).toBe(`${rev1}/signed.pdf`);
      expect(deletes()).toHaveLength(0);
      expectUnsent(rev2);
    });

    it('the intent is written just as the ROA completes → the row is untouched and NO delete is ever sent', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      mock.fixtures.onUpdate((p) => p.signing_meta?.supersession?.cancelRequestedAt, () => finishRow(rev1, envelopeId));

      const res = await send(rev2);

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_completed');
      expect(deletes()).toHaveLength(0);
      expect(rowOf(rev1).status).toBe('completed');
      expect(supersessionOf(rev1)).toBeUndefined(); // the stale intent never landed on the completed row
      expectUnsent(rev2);
    });

    it('the dispatch marker is written just as the ROA completes → no delete is sent', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      mock.fixtures.onUpdate((p) => p.signing_meta?.supersession?.deleteDispatchedAt, () => finishRow(rev1, envelopeId));

      const res = await send(rev2);

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_completed');
      expect(deletes()).toHaveLength(0); // the guard held BEFORE the provider was touched
      expect(rowOf(rev1).status).toBe('completed');
      expect(rowOf(rev1).signing_meta?.supersession?.deleteDispatchedAt).toBeUndefined();
      expectUnsent(rev2);
    });

    it('verified gone, but the ROA completed before the void could be recorded → the void is refused, completed stands', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      mock.fixtures.onUpdate((p) => p.status === 'voided', () => finishRow(rev1, envelopeId));

      const res = await send(rev2);

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_completed');
      expect(rowOf(rev1)).toMatchObject({ status: 'completed', signing_status: 'completed' });
      expect(rowOf(rev1).signed_pdf_storage_path).toBe(`${rev1}/signed.pdf`);
      expectUnsent(rev2);
    });

    it('a completion recorded but not yet status-flipped (completed_at set) is also protected', async () => {
      const { rev1, rev2 } = await livePair();
      // The in-between state a crashed reconcile leaves: completion time written, status not yet.
      mock.fixtures.putRow(rev1, { completed_at: '2026-10-29T09:00:00.000Z' });
      fake.complete('env-p1');
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_completed');
      expect(rowOf(rev1)).toMatchObject({ status: 'completed', signing_status: 'completed' });
      expect(rowOf(rev1).completed_at).toBe('2026-10-29T09:00:00.000Z');
      expect(deletes()).toHaveLength(0);
    });

    it('a late acknowledgement (404 + ack) cannot void a ROA that completed first', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      mock.fixtures.putRow(rev1, {
        signing_meta: {
          externalId: rev1,
          supersession: { replacementId: rev2, deleteDispatchedAt: '2026-10-29T08:00:01.000Z', deleteAcknowledgedAt: '2026-10-29T08:00:02.000Z' },
        },
      });
      fake.envelope(envelopeId).deleted = true;
      mock.fixtures.onUpdate((p) => p.status === 'voided', () => finishRow(rev1, envelopeId));

      const res = await refresh(rev1);

      expect(res.statusCode).toBe(200);
      expect(res.body.refreshed).toBe(false);
      expect(rowOf(rev1)).toMatchObject({ status: 'completed', signing_status: 'completed' });
      expect(res.body.submission.status).toBe('completed');
    });
  });

  describe('repository writes are broker-scoped and conditional', () => {
    const open = () => {
      const id = seedRevision1({ status: 'awaiting_signature', signing_provider: 'documenso', signing_status: 'pending' });
      return id;
    };

    it('another broker cannot apply an observation, a void, a state step, an adoption or a completion', async () => {
      const id = open();
      mock.fixtures.putRow(id, { superseded_by_submission_id: 'ROA-x', signing_provider: 'documenso' });
      const before = rowOf(id);
      expect(await repo.applyProviderObservation(id, WERNER_BROKER, { status: 'voided' })).toBeNull();
      expect(await repo.applyProviderObservation(id, WERNER_BROKER, { status: 'completed' }, { completion: true })).toBeNull();
      expect(await repo.markSupersededVoided(id, WERNER_BROKER, { a: 1 }, 'ROA-x')).toBeNull();
      expect(await repo.recordSupersessionState(id, WERNER_BROKER, { a: 1 })).toBeNull();
      expect(await repo.adoptRecoveredEnvelope(id, WERNER_BROKER, { signing_envelope_id: 'e' })).toBeNull();
      expect(await repo.setCompletionIfMissing(id, WERNER_BROKER, '2026-10-29T09:00:00.000Z')).toBeNull();
      expect(rowOf(id)).toEqual(before);
    });

    it('rejects an unusable broker identity instead of degrading to an unscoped write', async () => {
      const id = open();
      const before = rowOf(id);
      for (const broker of [null, {}, { normalizedEmail: '%' }, { normalizedEmail: 'a b@c.d' }]) {
        await expect(repo.applyProviderObservation(id, broker, { status: 'voided' })).rejects.toThrow(/invalid_broker_identity/);
        await expect(repo.markSupersededVoided(id, broker, {}, 'ROA-x')).rejects.toThrow(/invalid_broker_identity/);
      }
      expect(rowOf(id)).toEqual(before);
    });

    it.each(['completed', 'voided', 'declined', 'expired'])('no observation, void or state step ever matches a %s row', async (status) => {
      const id = open();
      mock.fixtures.putRow(id, { status, superseded_by_submission_id: 'ROA-x', ...(status === 'completed' ? { completed_at: '2026-10-29T09:00:00.000Z' } : {}) });
      const before = rowOf(id);
      expect(await repo.applyProviderObservation(id, ANDREW_BROKER, { status: 'voided', signing_status: 'cancelled' })).toBeNull();
      expect(await repo.markSupersededVoided(id, ANDREW_BROKER, { a: 1 }, 'ROA-x')).toBeNull();
      expect(await repo.recordSupersessionState(id, ANDREW_BROKER, { a: 1 })).toBeNull();
      expect(rowOf(id)).toEqual(before);
    });

    it('an open row with a completion time is protected from non-completion observations', async () => {
      const id = open();
      mock.fixtures.putRow(id, { completed_at: '2026-10-29T09:00:00.000Z' });
      const before = rowOf(id);
      expect(await repo.applyProviderObservation(id, ANDREW_BROKER, { signing_status: 'pending' })).toBeNull();
      expect(await repo.markSupersededVoided(id, ANDREW_BROKER, {}, 'ROA-x')).toBeNull();
      expect(rowOf(id)).toEqual(before);
      // …but the completing write itself is allowed.
      const done = await repo.applyProviderObservation(id, ANDREW_BROKER, { status: 'completed', signing_status: 'completed' }, { completion: true });
      expect(done).toMatchObject({ status: 'completed' });
    });

    it('only the revision that actually replaces a request can void it', async () => {
      const id = open();
      mock.fixtures.putRow(id, { superseded_by_submission_id: 'ROA-real' });
      expect(await repo.markSupersededVoided(id, ANDREW_BROKER, { a: 1 }, 'ROA-someone-else')).toBeNull();
      expect(rowOf(id).status).toBe('awaiting_signature');
      expect(await repo.markSupersededVoided(id, ANDREW_BROKER, { a: 1 }, 'ROA-real')).toMatchObject({ status: 'voided' });
    });

    it('a completion time cannot be recorded on a voided or declined row', async () => {
      for (const status of ['voided', 'declined']) {
        const id = open();
        mock.fixtures.putRow(id, { status });
        expect(await repo.setCompletionIfMissing(id, ANDREW_BROKER, '2026-10-29T09:00:00.000Z')).toBeNull();
        expect(rowOf(id).completed_at ?? null).toBeNull();
      }
    });
  });

  describe('legacy DocuSign reconcile follows the same rule', () => {
    it('a stale "sent" read cannot overwrite a record that completed in the meantime', async () => {
      process.env.DOCUSIGN_ENVIRONMENT = 'sandbox';
      process.env.DOCUSIGN_INTEGRATION_KEY = 'ik-test';
      process.env.DOCUSIGN_USER_ID = 'user-test';
      process.env.DOCUSIGN_ACCOUNT_ID = 'acct-test';
      const id = seedRevision1({
        status: 'awaiting_signature', docusign_envelope_id: 'ds-1', docusign_status: 'sent',
      });
      let completedRow;
      vi.mocked(global.fetch).mockImplementation(async () => {
        mock.fixtures.putRow(id, { status: 'completed', docusign_status: 'completed', completed_at: '2026-10-29T09:00:00.000Z' });
        completedRow = rowOf(id);
        return { ok: true, status: 200, async json() { return { status: 'sent' }; } };
      });

      const result = await reconcileSigningSubmission({ submissionId: id, row: rowOf(id), broker: ANDREW_BROKER });

      expect(rowOf(id)).toEqual(completedRow);
      expect(result.raceLost).toBe(true);
      expect(result.row).toMatchObject({ status: 'completed', docusign_status: 'completed' });
    });
  });
});

// =======================================================================================
describe('R2 — a signed recipient never loses the audit trail because a backup failed', () => {
  const auditDown = (response = () => fake.json({ message: 'audit log unavailable' }, 500)) =>
    fake.override(isAuditDownload, response, { once: false });

  it('keeps a verified copy BEFORE it deletes anything, and records which signatures it covers', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    expect((await send(rev2)).statusCode).toBe(200);

    const order = fake.calls.map((c) => `${c.method} ${c.path}`);
    expect(order.findIndex((c) => /audit-log\/download$/.test(c))).toBeGreaterThan(-1);
    expect(order.findIndex((c) => /audit-log\/download$/.test(c))).toBeLessThan(order.indexOf('POST /envelope/delete'));

    const copy = supersessionOf(rev1).auditLog;
    const expected = fake.auditLogBytes('env-p1');
    expect(copy).toMatchObject({ sha256: sha256HexOfBytes(expected), byteLength: expected.length, signedKey: '1' });
    expect(copy.verifiedAt).toBeTruthy();
    expect(mock.fixtures.getStorage(copy.path)).toEqual(expected);
    expect(rowOf(rev1)).toMatchObject({ status: 'voided' });
  });

  it('audit log unavailable (5xx) → NOTHING is deleted, the request stays live, the broker may retry', async () => {
    const { rev1, rev2, envelopeId } = await livePair({ partial: true });
    auditDown();

    const res = await send(rev2);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: 'predecessor_audit_backup_failed', retryable: true });
    expect(deletes()).toHaveLength(0);
    expect(fake.envelope(envelopeId).deleted).toBe(false);
    expect(fake.liveEnvelopes()).toHaveLength(1);
    expect(rowOf(rev1).status).toBe('awaiting_signature');
    expect(supersessionOf(rev1).auditBackup).toMatchObject({ attempts: 1, lastFailure: 'http_500', permanent: false });
    expect(supersessionOf(rev1).auditLog).toBeUndefined();
    expectUnsent(rev2);
  });

  it('a network failure while downloading is treated the same way', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    auditDown(() => { throw new Error('socket hang up'); });
    const res = await send(rev2);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('predecessor_audit_backup_failed');
    expect(deletes()).toHaveLength(0);
    expect(rowOf(rev1).status).toBe('awaiting_signature');
  });

  it('a body that is not a PDF is not a backup', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    auditDown(() => fake.pdf(Buffer.from('<html>gateway error</html>')));
    const res = await send(rev2);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('predecessor_audit_backup_failed');
    expect(supersessionOf(rev1).auditBackup.lastFailure).toBe('not_a_pdf');
    expect(deletes()).toHaveLength(0);
  });

  it('an empty body is not a backup', async () => {
    const { rev2 } = await livePair({ partial: true });
    auditDown(() => fake.pdf(Buffer.alloc(0)));
    expect((await send(rev2)).body.error).toBe('predecessor_audit_backup_failed');
    expect(deletes()).toHaveLength(0);
  });

  it('storage refuses the copy → nothing is deleted', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    mock.fixtures.failNextUpload();
    const res = await send(rev2);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('predecessor_audit_backup_failed');
    expect(deletes()).toHaveLength(0);
    expect(rowOf(rev1).status).toBe('awaiting_signature');
    // …and the very next attempt, with storage healthy again, succeeds.
    expect((await send(rev2)).statusCode).toBe(200);
    expect(supersessionOf(rev1).auditLog.verifiedAt).toBeTruthy();
  });

  it('storage keeps different bytes than were sent (silent corruption) → read-back catches it, nothing is deleted', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    mock.fixtures.corruptNextUpload();
    const res = await send(rev2);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('predecessor_audit_backup_failed');
    expect(supersessionOf(rev1).auditBackup.lastFailure).toBe('stored_copy_mismatch');
    expect(deletes()).toHaveLength(0);
    expect(supersessionOf(rev1).auditLog).toBeUndefined();
    // The corrupt object is never overwritten, so the next attempts also fail closed and escalate.
    for (let i = 1; i < AUDIT_BACKUP_MAX_ATTEMPTS; i += 1) await send(rev2);
    const last = await send(rev2);
    expect(last.statusCode).toBe(409);
    expect(last.body.error).toBe('predecessor_manual_resolution_required');
    expect(deletes()).toHaveLength(0);
  });

  it(`after ${AUDIT_BACKUP_MAX_ATTEMPTS} failed backups the broker is sent to MANUAL RESOLUTION — and it is visible`, async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    auditDown();

    const codes = [];
    for (let i = 0; i < AUDIT_BACKUP_MAX_ATTEMPTS; i += 1) {
      const res = await send(rev2);
      codes.push(res.body.error);
    }
    const final = await send(rev2);
    expect(codes.slice(0, -1).every((code) => code === 'predecessor_audit_backup_failed')).toBe(true);
    expect(codes.at(-1)).toBe('predecessor_manual_resolution_required');
    expect(final.statusCode).toBe(409);
    expect(final.body).toMatchObject({ error: 'predecessor_manual_resolution_required', reason: 'audit_backup_unavailable', retryable: false });

    expect(deletes()).toHaveLength(0);
    expect(fake.liveEnvelopes()).toHaveLength(1); // still live and untouched
    expect(rowOf(rev1).status).toBe('awaiting_signature');
    expect(supersessionOf(rev1).manualResolution).toMatchObject({ required: true, reason: 'audit_backup_unavailable' });
    expectUnsent(rev2);

    // The broker sees it on the request that is stuck…
    expect((await view(rev1)).supersessionManualResolution).toBe('audit_backup_unavailable');
    // …and a request that is not stuck shows nothing.
    expect((await view(rev2)).supersessionManualResolution).toBeNull();
  });

  it('a 4xx the provider will not fix (404 audit log) goes straight to manual resolution', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    auditDown(() => fake.json({ message: 'no audit log' }, 404));
    const res = await send(rev2);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: 'predecessor_manual_resolution_required', reason: 'audit_backup_unavailable' });
    expect(supersessionOf(rev1).auditBackup).toMatchObject({ attempts: 1, permanent: true });
    expect(deletes()).toHaveLength(0);
  });

  it('429 / 408 are transient, not permanent', async () => {
    const { rev2 } = await livePair({ partial: true });
    auditDown(() => fake.json({ message: 'slow down' }, 429));
    const res = await send(rev2);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe('predecessor_audit_backup_failed');
  });

  it('manual resolution is not a dead end for the app: once the audit log is available the same send completes', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    const fix = auditDown();
    for (let i = 0; i <= AUDIT_BACKUP_MAX_ATTEMPTS; i += 1) await send(rev2);
    expect(rowOf(rev1).status).toBe('awaiting_signature');

    fix();
    const res = await send(rev2);

    expect(res.statusCode).toBe(200);
    expect(rowOf(rev1).status).toBe('voided');
    expect(supersessionOf(rev1).auditLog.verifiedAt).toBeTruthy();
    expect(supersessionOf(rev1).auditBackup.attempts).toBe(0);
    expect(supersessionOf(rev1).manualResolution.resolvedAt).toBeTruthy();
    expect((await view(rev1)).supersessionManualResolution).toBeNull(); // history, not a live alert
    expect(fake.liveEnvelopes()).toHaveLength(1);
  });

  it('the operator route works: after a person preserves the log and voids it in Documenso, the replacement goes out', async () => {
    const { rev1, rev2, envelopeId } = await livePair({ partial: true });
    auditDown();
    for (let i = 0; i <= AUDIT_BACKUP_MAX_ATTEMPTS; i += 1) await send(rev2);
    expect(deletes()).toHaveLength(0);

    // Out of band: audit log saved by hand, request cancelled in Documenso, row set to voided.
    fake.envelope(envelopeId).deleted = true;
    mock.fixtures.putRow(rev1, { status: 'voided', signing_status: 'cancelled' });

    const res = await send(rev2);
    expect(res.statusCode).toBe(200);
    expect(deletes()).toHaveLength(0); // the app did not delete anything itself
    expect(fake.liveEnvelopes()).toHaveLength(1);
    expect((await view(rev1)).supersessionManualResolution).toBeNull();
  });

  it('nobody has signed → no backup is needed, so an unavailable audit log blocks nothing', async () => {
    const { rev1, rev2 } = await livePair({ partial: false });
    auditDown();
    const res = await send(rev2);
    expect(res.statusCode).toBe(200);
    expect(auditDownloads()).toHaveLength(0);
    expect(supersessionOf(rev1).auditLog).toBeUndefined();
    expect(rowOf(rev1).status).toBe('voided');
  });

  it('a never-distributed DRAFT cannot have been signed, so it needs no backup either', async () => {
    const { rev1, rev2 } = await livePair({ envelopeStatus: 'DRAFT' });
    auditDown();
    expect((await send(rev2)).statusCode).toBe(200);
    expect(auditDownloads()).toHaveLength(0);
    expect(rowOf(rev1).status).toBe('voided');
  });

  it('recipient progress that cannot be read is treated as "possibly signed": blocked while the log is unavailable', async () => {
    const { rev1, rev2 } = await livePair({ recipients: [] });
    auditDown();
    const blocked = await send(rev2);
    expect(blocked.statusCode).toBe(503);
    expect(blocked.body.error).toBe('predecessor_audit_backup_failed');
    expect(deletes()).toHaveLength(0);
    expect(rowOf(rev1).status).toBe('awaiting_signature');
  });

  it('…and proceeds, with the copy recorded as covering "unknown" progress, once the log is available', async () => {
    const { rev1, rev2 } = await livePair({ recipients: [] });
    expect((await send(rev2)).statusCode).toBe(200);
    expect(supersessionOf(rev1).auditLog.signedKey).toBe('unknown');
    expect(rowOf(rev1).status).toBe('voided');
  });

  it('a recipient state we do not recognise is treated as "possibly signed" too', async () => {
    const odd = [
      { id: 101, role: 'SIGNER', signingOrder: 1, signingStatus: 'SOMETHING_NEW' },
      { id: 102, role: 'SIGNER', signingOrder: 2, signingStatus: 'NOT_SIGNED' },
    ];
    const { rev1, rev2 } = await livePair({ recipients: odd });
    expect((await send(rev2)).statusCode).toBe(200);
    expect(auditDownloads()).toHaveLength(1);
    expect(supersessionOf(rev1).auditLog.signedKey).toBe('unknown');
  });

  it('signing progress changing after the backup → the old copy no longer covers it: nothing deleted, retry re-backs-up', async () => {
    const three = [
      { id: 101, role: 'SIGNER', signingOrder: 1, signingStatus: 'SIGNED' },
      { id: 102, role: 'SIGNER', signingOrder: 2, signingStatus: 'NOT_SIGNED' },
      { id: 103, role: 'SIGNER', signingOrder: 3, signingStatus: 'NOT_SIGNED' },
    ];
    const { rev1, rev2, envelopeId } = await livePair({ recipients: three });
    // The second signer signs while the first backup is being made.
    fake.override(isAuditDownload, () => {
      fake.signRecipient(envelopeId, 2);
      return fake.pdf(fake.auditLogBytes(envelopeId));
    });

    const first = await send(rev2);

    expect(first.statusCode).toBe(409);
    expect(first.body).toMatchObject({ error: 'predecessor_changed', retryable: true });
    expect(deletes()).toHaveLength(0);
    expect(supersessionOf(rev1).auditLog.signedKey).toBe('1'); // covers only the first signature

    const retry = await send(rev2);
    expect(retry.statusCode).toBe(200);
    expect(supersessionOf(rev1).auditLog.signedKey).toBe('1,2'); // re-taken for the new progress
    expect(auditDownloads()).toHaveLength(2);
  });

  it('a verified copy is reused by a retry (no second download) when the progress is unchanged', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    fake.override(isDelete, () => fake.json({ message: 'boom' }, 500));
    const first = await send(rev2);
    expect(first.statusCode).toBe(503);
    expect(auditDownloads()).toHaveLength(1);
    const copy = supersessionOf(rev1).auditLog;

    expect((await send(rev2)).statusCode).toBe(200);
    expect(auditDownloads()).toHaveLength(1);
    expect(supersessionOf(rev1).auditLog.path).toBe(copy.path);
  });

  it('the request completes while its audit log is being saved → nothing is deleted, it stays the signed record', async () => {
    const { rev1, rev2, envelopeId } = await livePair({ partial: true });
    fake.override(isAuditDownload, () => {
      fake.complete(envelopeId);
      return fake.pdf(fake.auditLogBytes(envelopeId));
    });

    const res = await send(rev2);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('predecessor_completed');
    expect(deletes()).toHaveLength(0);
    expect(fake.envelope(envelopeId).deleted).toBe(false);
    expect(rowOf(rev1)).toMatchObject({ status: 'completed', signing_status: 'completed' });
    expect(rowOf(rev1).signed_pdf_storage_path).toBe(`${rev1}/signed.pdf`);
    expectUnsent(rev2);
  });

  it('the replacement gate never leaks recipient identity into the stored audit trail record', async () => {
    const { rev1, rev2 } = await livePair({ partial: true });
    expect((await send(rev2)).statusCode).toBe(200);
    expect(JSON.stringify(rowOf(rev1).signing_meta)).not.toMatch(/@|client@|broker@/);
  });
});

// =======================================================================================
describe('R3 — the gap between recording the intent and sending the delete', () => {
  const dbDownOn = (match) => mock.fixtures.onUpdate(match, () => ({ error: { message: 'db down' } }));
  const staleDispatch = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

  describe('a crash in the gap', () => {
    it('intent saved, then the dispatch cannot be recorded → no delete is sent; the retry completes cleanly', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      dbDownOn((p) => p.signing_meta?.supersession?.deleteDispatchedAt);

      const crashed = await send(rev2);

      expect(crashed.statusCode).toBe(500);
      expect(crashed.body).toMatchObject({ error: 'replacement_gate_failed', retryable: true });
      expect(deletes()).toHaveLength(0);
      expect(fake.envelope(envelopeId).deleted).toBe(false);
      expect(supersessionOf(rev1).cancelRequestedAt).toBeTruthy(); // intent survived
      expect(supersessionOf(rev1).deleteDispatchedAt).toBeUndefined();
      expectUnsent(rev2);

      const retry = await send(rev2);
      expect(retry.statusCode).toBe(200);
      expect(deletes()).toHaveLength(1);
      expect(rowOf(rev1)).toMatchObject({ status: 'voided' });
      expect(supersessionOf(rev1).verifiedBy).toBe('gone_after_acknowledged_delete');
      expect(fake.liveEnvelopes()).toHaveLength(1);
    });

    it('intent saved, process dies, and the envelope is removed by SOMEONE ELSE meanwhile → a 404 is NOT ours: manual resolution', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      dbDownOn((p) => p.signing_meta?.supersession?.deleteDispatchedAt);
      await send(rev2); // crashes after the intent, before any delete
      expect(deletes()).toHaveLength(0);

      fake.envelope(envelopeId).deleted = true; // deleted in the Documenso UI during the outage

      const retry = await send(rev2);

      expect(retry.statusCode).toBe(409);
      expect(retry.body).toMatchObject({
        error: 'predecessor_manual_resolution_required', reason: 'delete_not_dispatched', retryable: false,
      });
      expect(rowOf(rev1).status).toBe('awaiting_signature'); // NOT voided on the strength of an intent
      expect(rowOf(rev1).signing_meta.supersession.verifiedBy).toBeUndefined();
      expect(deletes()).toHaveLength(0);
      expectUnsent(rev2);
      expect((await view(rev1)).supersessionManualResolution).toBe('delete_not_dispatched');
    });

    it('the envelope vanishes between the intent and the fresh pre-delete read → manual resolution, no delete', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      mock.fixtures.onUpdate((p) => p.signing_meta?.supersession?.cancelRequestedAt, () => {
        fake.envelope(envelopeId).deleted = true;
      });
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({ error: 'predecessor_manual_resolution_required', reason: 'delete_not_dispatched' });
      expect(deletes()).toHaveLength(0);
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });

    it('the ROA completes between the intent and the fresh pre-delete read → the delete is never sent', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      mock.fixtures.onUpdate((p) => p.signing_meta?.supersession?.cancelRequestedAt, () => {
        fake.complete(envelopeId);
      });
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_completed');
      expect(deletes()).toHaveLength(0);
      expect(fake.envelope(envelopeId).deleted).toBe(false);
      expect(rowOf(rev1)).toMatchObject({ status: 'completed' });
      expect(rowOf(rev1).signed_pdf_storage_path).toBeTruthy();
    });

    it('delete acknowledged, but the void cannot be recorded (crash) → the retry finishes from the ACKNOWLEDGEMENT', async () => {
      const { rev1, rev2 } = await livePair();
      dbDownOn((p) => p.status === 'voided');

      const crashed = await send(rev2);

      expect(crashed.statusCode).toBe(500);
      expect(deletes()).toHaveLength(1);
      expect(rowOf(rev1).status).toBe('awaiting_signature');
      expect(supersessionOf(rev1).deleteAcknowledgedAt).toBeTruthy();

      const retry = await send(rev2);
      expect(retry.statusCode).toBe(200);
      expect(deletes()).toHaveLength(1); // not deleted twice
      expect(rowOf(rev1)).toMatchObject({ status: 'voided', signing_status: 'cancelled' });
      expect(supersessionOf(rev1).verifiedBy).toBe('not_found_after_acknowledged_delete');
      expect(fake.liveEnvelopes()).toHaveLength(1);
    });

    it('delete acknowledged but the acknowledgement cannot be persisted → this attempt still completes (it holds it in memory)', async () => {
      const { rev1, rev2 } = await livePair();
      dbDownOn((p) => p.signing_meta?.supersession?.deleteAcknowledgedAt && !p.signing_meta.supersession.cancelledAt);
      const res = await send(rev2);
      expect(res.statusCode).toBe(200);
      expect(rowOf(rev1).status).toBe('voided');
      expect(supersessionOf(rev1).deleteAcknowledgedAt).toBeTruthy(); // written with the final void
    });
  });

  describe('an unacknowledged delete is not proof', () => {
    // Dispatched, response lost, and the verification read also failed: the one real hole.
    async function lostAcknowledgement() {
      const pair = await livePair();
      const { envelopeId } = pair;
      fake.override(isDelete, () => {
        fake.envelope(envelopeId).deleted = true; // it worked…
        throw new Error('connection reset'); // …but the reply was lost
      });
      const first = await send(pair.rev2);
      return { ...pair, first };
    }

    it('delete worked but the reply was lost → blocked and retryable; never voided on a guess', async () => {
      const { rev1, rev2, first } = await lostAcknowledgement();
      expect(first.statusCode).toBe(503);
      expect(first.body).toMatchObject({ error: 'predecessor_cancel_unverified', retryable: true });
      expect(rowOf(rev1).status).toBe('awaiting_signature');
      expect(supersessionOf(rev1).deleteDispatchedAt).toBeTruthy();
      expect(supersessionOf(rev1).deleteAcknowledgedAt).toBeUndefined();
      expectUnsent(rev2);
    });

    it('an immediate retry (inside the grace window) is told to wait, not sent to a person yet', async () => {
      const { rev1, rev2 } = await lostAcknowledgement();
      const retry = await send(rev2);
      expect(retry.statusCode).toBe(503);
      expect(retry.body).toMatchObject({ error: 'predecessor_cancel_unverified', retryable: true });
      expect(rowOf(rev1).status).toBe('awaiting_signature');
      expect(supersessionOf(rev1).manualResolution).toBeUndefined();
    });

    it('after the grace window with still no acknowledgement → manual resolution (and nothing is voided or sent)', async () => {
      const { rev1, rev2 } = await lostAcknowledgement();
      mock.fixtures.putRow(rev1, {
        signing_meta: {
          ...rowOf(rev1).signing_meta,
          supersession: { ...supersessionOf(rev1), deleteDispatchedAt: staleDispatch(DELETE_IN_FLIGHT_GRACE_MS / 1000 + 60) },
        },
      });
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        error: 'predecessor_manual_resolution_required', reason: 'delete_unacknowledged', retryable: false,
      });
      expect(rowOf(rev1).status).toBe('awaiting_signature');
      expect(deletes()).toHaveLength(1); // the original attempt only
      expectUnsent(rev2);
      expect((await view(rev1)).supersessionManualResolution).toBe('delete_unacknowledged');
    });

    it('the grace boundary: 30 s ago still waits, 90 s ago does not', async () => {
      const { rev1, rev2 } = await lostAcknowledgement();
      for (const [age, expected] of [[30, 'predecessor_cancel_unverified'], [90, 'predecessor_manual_resolution_required']]) {
        mock.fixtures.putRow(rev1, {
          signing_meta: { ...rowOf(rev1).signing_meta, supersession: { ...supersessionOf(rev1), deleteDispatchedAt: staleDispatch(age) } },
        });
        expect((await send(rev2)).body.error, `${age}s`).toBe(expected);
      }
    });

    it('delete answered 404 (it was already gone when we asked) → not an acknowledgement', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      fake.override(isDelete, () => {
        fake.envelope(envelopeId).deleted = true;
        return fake.json({ message: 'Envelope not found' }, 404);
      });
      const res = await send(rev2);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe('predecessor_cancel_unverified');
      expect(supersessionOf(rev1).deleteAcknowledgedAt).toBeUndefined();
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });

    it('a stale acknowledgement for a DIFFERENT replacement is not accepted', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      mock.fixtures.putRow(rev1, {
        signing_meta: {
          externalId: rev1,
          supersession: { replacementId: 'ROA-someone-else', deleteDispatchedAt: staleDispatch(600), deleteAcknowledgedAt: staleDispatch(599) },
        },
      });
      fake.envelope(envelopeId).deleted = true;
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_manual_resolution_required');
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });

    it('providerAcknowledgedOurDelete needs the acknowledgement AND the matching forward link', () => {
      const row = (over = {}) => ({
        superseded_by_submission_id: 'ROA-b',
        signing_meta: { supersession: { replacementId: 'ROA-b', cancelRequestedAt: 't', deleteDispatchedAt: 't', deleteAcknowledgedAt: 't' } },
        ...over,
      });
      expect(providerAcknowledgedOurDelete(row())).toBe(true);
      expect(providerAcknowledgedOurDelete(row({ superseded_by_submission_id: 'ROA-c' }))).toBe(false);
      expect(providerAcknowledgedOurDelete(row({ superseded_by_submission_id: null }))).toBe(false);
      expect(providerAcknowledgedOurDelete({ superseded_by_submission_id: 'ROA-b', signing_meta: { supersession: { replacementId: 'ROA-b', cancelRequestedAt: 't', deleteDispatchedAt: 't' } } })).toBe(false);
      expect(providerAcknowledgedOurDelete({ superseded_by_submission_id: 'ROA-b', signing_meta: { supersession: { replacementId: 'ROA-b', cancelRequestedAt: 't' } } })).toBe(false);
      expect(providerAcknowledgedOurDelete({ superseded_by_submission_id: 'ROA-b', signing_meta: {} })).toBe(false);
      expect(providerAcknowledgedOurDelete(null)).toBe(false);
    });
  });

  describe('the register refresh follows the same rule', () => {
    it('an intent or a dispatch without an acknowledgement does not void on a 404; an acknowledgement does', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      fake.envelope(envelopeId).deleted = true;
      const supersession = (extra) => ({
        externalId: rev1,
        supersession: { replacementId: rev2, cancelRequestedAt: '2026-10-29T08:00:00.000Z', ...extra },
      });

      mock.fixtures.putRow(rev1, { signing_meta: supersession({}) });
      expect((await refresh(rev1)).statusCode).toBeGreaterThanOrEqual(400);
      expect(rowOf(rev1).status).toBe('awaiting_signature');

      mock.fixtures.putRow(rev1, { signing_meta: supersession({ deleteDispatchedAt: '2026-10-29T08:00:01.000Z' }) });
      expect((await refresh(rev1)).statusCode).toBeGreaterThanOrEqual(400);
      expect(rowOf(rev1).status).toBe('awaiting_signature');

      mock.fixtures.putRow(rev1, {
        signing_meta: supersession({ deleteDispatchedAt: '2026-10-29T08:00:01.000Z', deleteAcknowledgedAt: '2026-10-29T08:00:02.000Z' }),
      });
      const done = await refresh(rev1);
      expect(done.statusCode).toBe(200);
      expect(rowOf(rev1)).toMatchObject({ status: 'voided', signing_status: 'cancelled' });
    });

    it('an acknowledgement on a row that is NOT linked to that replacement is ignored', async () => {
      const rev1 = seedRevision1();
      const envelopeId = sendRevision(rev1);
      mock.fixtures.putRow(rev1, {
        signing_meta: { externalId: rev1, supersession: { replacementId: 'ROA-x', deleteAcknowledgedAt: '2026-10-29T08:00:02.000Z' } },
      });
      fake.envelope(envelopeId).deleted = true;
      expect((await refresh(rev1)).statusCode).toBeGreaterThanOrEqual(400);
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });
  });

  describe('concurrent attempts (two tabs) converge', () => {
    it('both race through the whole sequence: one live envelope, one voided predecessor, no manual flag left behind', async () => {
      const { rev1, rev2 } = await livePair({ partial: true });
      const [a, b] = await Promise.all([send(rev2), send(rev2)]);

      expect([a.statusCode, b.statusCode]).toContain(200);
      for (const res of [a, b]) {
        expect([200, 409, 503]).toContain(res.statusCode);
        expect(res.body.error).not.toBe('predecessor_manual_resolution_required');
      }
      expect(created()).toHaveLength(1);
      expect(fake.liveEnvelopes()).toHaveLength(1);
      expect(rowOf(rev1).status).toBe('voided');
      expect(supersessionOf(rev1).manualResolution).toBeUndefined();
      expect((await view(rev1)).supersessionManualResolution).toBeNull();
    });

    it('the loser of a race follows the winner\'s persisted acknowledgement instead of failing', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      // The other tab's delete lands first; ours then finds the envelope gone and no ack of our own.
      fake.override(isDelete, () => {
        fake.envelope(envelopeId).deleted = true;
        mock.fixtures.putRow(rev1, {
          signing_meta: {
            ...rowOf(rev1).signing_meta,
            supersession: { ...supersessionOf(rev1), deleteAcknowledgedAt: new Date().toISOString() },
          },
        });
        return fake.json({ message: 'Envelope not found' }, 404);
      });
      const res = await send(rev2);
      expect(res.statusCode).toBe(200);
      expect(rowOf(rev1).status).toBe('voided');
    });

    it('the loser sees the predecessor already voided by the winner and carries on', async () => {
      const { rev1, rev2, envelopeId } = await livePair();
      fake.override(isDelete, () => {
        fake.envelope(envelopeId).deleted = true;
        mock.fixtures.putRow(rev1, { status: 'voided', signing_status: 'cancelled' });
        return fake.json({ message: 'Envelope not found' }, 404);
      });
      expect((await send(rev2)).statusCode).toBe(200);
      expect(fake.liveEnvelopes()).toHaveLength(1);
    });
  });
});

// =======================================================================================
describe('client view', () => {
  it('shows a manual-resolution flag only while the request is still open', async () => {
    const rev1 = seedRevision1();
    sendRevision(rev1);
    mock.fixtures.putRow(rev1, {
      signing_meta: { externalId: rev1, supersession: { manualResolution: { required: true, reason: 'delete_unacknowledged', flaggedAt: 't' } } },
    });
    expect((await view(rev1)).supersessionManualResolution).toBe('delete_unacknowledged');
    mock.fixtures.putRow(rev1, { status: 'voided' });
    expect((await view(rev1)).supersessionManualResolution).toBeNull();
    mock.fixtures.putRow(rev1, { status: 'awaiting_signature', completed_at: '2026-10-29T09:00:00.000Z' });
    expect((await view(rev1)).supersessionManualResolution).toBeNull();
    mock.fixtures.putRow(rev1, {
      status: 'awaiting_signature', completed_at: null,
      signing_meta: { supersession: { manualResolution: { required: true, reason: 'x', resolvedAt: 't' } } },
    });
    expect((await view(rev1)).supersessionManualResolution).toBeNull();
  });

  it('does not expose anything else from the supersession state', async () => {
    const rev1 = seedRevision1();
    sendRevision(rev1);
    mock.fixtures.putRow(rev1, {
      signing_meta: {
        externalId: rev1,
        supersession: { auditLog: { path: 'x/y.pdf', sha256: 'a'.repeat(64) }, recipients: [{ signingOrder: 1 }], deleteAcknowledgedAt: 't' },
      },
    });
    const body = JSON.stringify(await view(rev1));
    expect(body).not.toMatch(/auditLog|superseded-audit|deleteAcknowledgedAt|recipients/);
  });
});
