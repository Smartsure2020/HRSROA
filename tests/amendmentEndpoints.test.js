// Amend ROA (Issue #8) — endpoint-level behaviour.
//
// Offline: Supabase is the in-memory mock (whose revision RPC mirrors the SQL function that
// tests/amendmentSql.test.js executes against a real Postgres) and Documenso is the
// stateful fake in testUtils/fakeDocumenso.js. Nothing touches a network or production data.
//
// What these tests pin down:
//   * revisions are created, never edited: the original row, canonical PDF, signed evidence
//     and status are byte-for-byte unchanged;
//   * the chain is linear and retries / double-clicks / two tabs converge on one revision;
//   * a replacement can only be distributed once the previous request is VERIFIED not live,
//     and any doubt (provider error, ambiguity, late completion) blocks the send;
//   * broker isolation holds for every new read and write.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';
import { makeFakeDocumenso } from './testUtils/fakeDocumenso.js';
import { TEST_TOKENS } from './testUtils/testJwt.js';
import { sha256HexOfBytes } from '../api/_lib/sha256.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));
vi.mock('../api/_lib/docusignJwt.js', () => ({ getDocusignAccessToken: vi.fn(async () => 'unused') }));
vi.mock('../api/_lib/docusignAccount.js', () => ({
  resolveDocusignAccountBaseUrl: vi.fn(async () => ({ baseUrl: 'https://unused.test' })),
}));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const getHandler = (await import('../api/roa-submissions/get.js')).default;
const listHandler = (await import('../api/roa-submissions/list.js')).default;
const sendHandler = (await import('../api/roa-submissions/send-for-signature.js')).default;
const reminderHandler = (await import('../api/roa-submissions/send-reminder.js')).default;
const refreshHandler = (await import('../api/roa-submissions/refresh.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };
let fake;

const ANDREW = TEST_TOKENS.andrew;
const WERNER = TEST_TOKENS.werner;
const STRANGER = TEST_TOKENS.stranger;

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
  templateVersion: 'T-2026',
  statutoryDisclosureVersion: 'S-2026',
  brokerAppointmentVersion: 'A-2026',
  brokerFeeVersion: 'F-2026',
};

const PERSONAL = {
  title: 'Ms', firstName: 'Jane', surname: 'Doe', idNumber: '8001015009087',
  email: 'jane@example.com', brokerName: 'Andrew Penney', recInsurer: 'Stratsys',
  accountNumber: 'ACCT-SENTINEL-1234567890', bankName: 'BANK-SENTINEL',
};
const COMMERCIAL = {
  companyName: 'ACME Pty Ltd', registrationNo: '2020/123456/07', contactPerson: 'Alex Rivera',
  email: 'alex@acme.example', brokerName: 'Andrew Penney',
};

/** A first submission seeded directly (as if created long ago), with real storage objects. */
function seedRevision1({
  roaType = 'Personal',
  status = 'submitted',
  advisorEmail = 'andrew@hrsinsurance.co.za',
  snapshot = roaType === 'Personal' ? PERSONAL : COMMERCIAL,
  ...overrides
} = {}) {
  const id = overrides.id ?? generateSubmissionId();
  const canonical = pdf(`canonical-${id}`);
  const row = {
    id,
    roa_type: roaType,
    status,
    advisor_user_id: '11111111-0000-4000-8000-0000000000a1',
    advisor_email: advisorEmail,
    client_reference: roaType === 'Personal' ? 'Personal – Jane Doe' : 'Commercial – ACME Pty Ltd',
    snapshot_json: snapshot,
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
  return { id, canonical };
}

/** Marks a seeded row as fully signed, with all three evidence objects in storage. */
function signRevision(id, { provider = 'documenso', envelopeId = `env-signed-${id.slice(4, 12)}` } = {}) {
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
    signing_provider: provider,
    signing_envelope_id: envelopeId,
    signing_status: 'completed',
    completed_at: '2026-09-02T10:00:00.000Z',
    evidence_retrieved_at: '2026-09-02T10:05:00.000Z',
    sent_for_signature_at: '2026-09-01T09:00:00.000Z',
  });
}

/** Marks a seeded row as sent to Documenso, with a live envelope in the fake. */
function sendRevision(id, { envelopeStatus = 'PENDING', envelopeId = 'env-p1', status = 'awaiting_signature' } = {}) {
  fake.seedEnvelope({ id: envelopeId, externalId: id, status: envelopeStatus });
  mock.fixtures.putRow(id, {
    status,
    signing_provider: 'documenso',
    signing_envelope_id: envelopeId,
    signing_item_id: `item-${envelopeId}`,
    signing_status: envelopeStatus.toLowerCase(),
    signing_meta: { externalId: id },
    sent_for_signature_at: '2026-09-01T09:00:00.000Z',
  });
  return envelopeId;
}

async function amend({
  token = ANDREW,
  from,
  roaType = 'Personal',
  snapshot,
  reason = 'incorrect_email',
  reasonDetail,
  submissionId = generateSubmissionId(),
  bytes,
  amendment,
  body = {},
} = {}) {
  const canonical = bytes ?? pdf(`revision-${submissionId}`);
  const res = mockRes();
  await createHandler({
    method: 'POST',
    headers: bearer(token),
    body: {
      submissionId,
      roaType,
      snapshot: snapshot ?? (roaType === 'Personal'
        ? { ...PERSONAL, email: 'jane.corrected@example.com' }
        : { ...COMMERCIAL, email: 'alex.corrected@acme.example' }),
      versions: VERSIONS,
      pdfBase64: canonical.toString('base64'),
      amendment: amendment === undefined
        ? { supersedesSubmissionId: from, reason, ...(reasonDetail !== undefined ? { reasonDetail } : {}) }
        : amendment,
      ...body,
    },
  }, res);
  return { res, submissionId, bytes: canonical };
}

async function send(submissionId, token = ANDREW) {
  const res = mockRes();
  await sendHandler({ method: 'POST', headers: bearer(token), body: { submissionId } }, res);
  return res;
}

async function getAs(token, id, query = {}) {
  const res = mockRes();
  await getHandler({ method: 'GET', headers: bearer(token), query: { id, ...query } }, res);
  return res;
}

const rowOf = (id) => mock.fixtures.getRow(id);
const withoutLink = (row) => {
  const { superseded_by_submission_id: _link, updated_at: _updated, ...rest } = row;
  return rest;
};

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
  mock.fixtures.addAuthUser(STRANGER, { id: 'user-stranger', email: 'stranger@example.com' });
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

// ---------------------------------------------------------------------------------------
describe('creating a revision', () => {
  it.each(['Personal', 'Commercial'])('creates the next %s revision and leaves the original untouched', async (roaType) => {
    const { id: rev1, canonical } = seedRevision1({ roaType });
    signRevision(rev1);
    const before = rowOf(rev1);
    const evidenceBefore = ['signed', 'certificate', 'audit-log'].map((f) => mock.fixtures.getStorage(`${rev1}/${f}.pdf`));

    const { res, submissionId, bytes } = await amend({ from: rev1, roaType, reason: 'client_information_changed', reasonDetail: 'New postal address' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true, submissionId, roaType, status: 'submitted', revisionNo: 2,
      supersedesSubmissionId: rev1, parentSubmissionId: rev1,
      pdfSha256: sha256HexOfBytes(bytes),
    });

    const rev2 = rowOf(submissionId);
    expect(rev2).toMatchObject({
      revision_no: 2, parent_submission_id: rev1, supersedes_submission_id: rev1,
      amendment_reason: 'client_information_changed', amendment_reason_detail: 'New postal address',
      amended_by: 'andrew@hrsinsurance.co.za', advisor_email: 'andrew@hrsinsurance.co.za',
      status: 'submitted', pdf_sha256: sha256HexOfBytes(bytes),
      pdf_storage_path: `${submissionId}/canonical.pdf`,
    });
    expect(rev2.amended_at).toBeTruthy();
    expect(rev2.superseded_by_submission_id).toBeNull();
    expect(rev2.signing_envelope_id ?? null).toBeNull();
    expect(mock.fixtures.getStorage(`${submissionId}/canonical.pdf`).equals(bytes)).toBe(true);

    // The original: only its forward link changed. Status, snapshot, hashes, evidence,
    // timestamps — identical. Its canonical and signed objects are byte-identical.
    const after = rowOf(rev1);
    expect(after.superseded_by_submission_id).toBe(submissionId);
    expect(withoutLink(after)).toEqual(withoutLink(before));
    expect(after.status).toBe('completed');
    expect(mock.fixtures.getStorage(`${rev1}/canonical.pdf`).equals(canonical)).toBe(true);
    ['signed', 'certificate', 'audit-log'].forEach((file, i) => {
      expect(mock.fixtures.getStorage(`${rev1}/${file}.pdf`).equals(evidenceBefore[i])).toBe(true);
    });
  });

  it('derives revision metadata on the server and ignores anything the browser claims', async () => {
    const { id: rev1 } = seedRevision1();
    const { res, submissionId } = await amend({
      from: rev1,
      amendment: {
        supersedesSubmissionId: rev1,
        reason: 'spelling_correction',
        revisionNo: 99,
        revision_no: 99,
        amendedBy: 'attacker@example.com',
        amended_by: 'attacker@example.com',
        parentSubmissionId: 'ROA-00000000-0000-4000-8000-000000000000',
        amendedAt: '1999-01-01T00:00:00Z',
      },
      body: { revision_no: 50, advisor_email: 'attacker@example.com', status: 'completed' },
    });
    expect(res.statusCode).toBe(200);
    expect(rowOf(submissionId)).toMatchObject({
      revision_no: 2,
      parent_submission_id: rev1,
      amended_by: 'andrew@hrsinsurance.co.za',
      advisor_email: 'andrew@hrsinsurance.co.za',
      status: 'submitted',
    });
    expect(rowOf(submissionId).amended_at).not.toContain('1999');
  });

  it.each([
    ['missing reason', { supersedesSubmissionId: 'SELF' }],
    ['unknown reason', { supersedesSubmissionId: 'SELF', reason: 'because' }],
    ['"other" without a note', { supersedesSubmissionId: 'SELF', reason: 'other' }],
    ['"other" with a blank note', { supersedesSubmissionId: 'SELF', reason: 'other', reasonDetail: '   ' }],
    ['over-long note', { supersedesSubmissionId: 'SELF', reason: 'incorrect_email', reasonDetail: 'x'.repeat(501) }],
    ['bad predecessor id', { supersedesSubmissionId: 'not-an-id', reason: 'incorrect_email' }],
    ['non-object amendment', 'incorrect_email'],
  ])('rejects %s with 400 and writes nothing', async (_name, amendment) => {
    const { id: rev1 } = seedRevision1();
    const filled = typeof amendment === 'object'
      ? { ...amendment, supersedesSubmissionId: amendment.supersedesSubmissionId === 'SELF' ? rev1 : amendment.supersedesSubmissionId }
      : amendment;
    const rows = mock.fixtures.countRows();
    const objects = mock.fixtures.countObjects();
    const { res } = await amend({ amendment: filled });
    expect(res.statusCode).toBe(400);
    expect(mock.fixtures.countRows()).toBe(rows);
    expect(mock.fixtures.countObjects()).toBe(objects);
    expect(rowOf(rev1).superseded_by_submission_id ?? null).toBeNull();
  });

  it('accepts "other" with a note and stores the note', async () => {
    const { id: rev1 } = seedRevision1();
    const { res, submissionId } = await amend({ from: rev1, reason: 'other', reasonDetail: '  Client moved house  ' });
    expect(res.statusCode).toBe(200);
    expect(rowOf(submissionId)).toMatchObject({ amendment_reason: 'other', amendment_reason_detail: 'Client moved house' });
  });

  it('refuses to amend another broker\'s ROA (404) and an unlisted user (403), writing nothing', async () => {
    const { id: rev1 } = seedRevision1({ advisorEmail: 'andrew@hrsinsurance.co.za' });
    const rows = mock.fixtures.countRows();
    const other = await amend({ token: WERNER, from: rev1 });
    expect(other.res.statusCode).toBe(404);
    expect(other.res.body).toEqual({ error: 'predecessor_not_found' });
    const stranger = await amend({ token: STRANGER, from: rev1 });
    expect(stranger.res.statusCode).toBe(403);
    expect(mock.fixtures.countRows()).toBe(rows);
    expect(rowOf(rev1).superseded_by_submission_id ?? null).toBeNull();
  });

  it('does not let a ROA be amended into a different type', async () => {
    const { id: rev1 } = seedRevision1({ roaType: 'Personal' });
    const { res } = await amend({ from: rev1, roaType: 'Commercial', snapshot: COMMERCIAL });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('roa_type_mismatch');
  });

  it('keeps the chain linear: the head is amendable, a superseded revision is not', async () => {
    const { id: rev1 } = seedRevision1();
    const second = await amend({ from: rev1 });
    expect(second.res.statusCode).toBe(200);

    const rows = mock.fixtures.countRows();
    const objects = mock.fixtures.countObjects();
    const branch = await amend({ from: rev1 });
    expect(branch.res.statusCode).toBe(409);
    expect(branch.res.body.error).toBe('already_superseded');
    expect(mock.fixtures.countRows()).toBe(rows);
    expect(mock.fixtures.countObjects()).toBe(objects); // refused before any upload

    const third = await amend({ from: second.submissionId, reason: 'other', reasonDetail: 'Third time' });
    expect(third.res.statusCode).toBe(200);
    expect(rowOf(third.submissionId)).toMatchObject({
      revision_no: 3, parent_submission_id: rev1, supersedes_submission_id: second.submissionId,
    });
    expect(rowOf(second.submissionId).superseded_by_submission_id).toBe(third.submissionId);
    expect(rowOf(rev1).superseded_by_submission_id).toBe(second.submissionId);
  });

  it.each([
    ['submitted', {}],
    ['signature_failed', {}],
    ['declined', {}],
    ['voided', {}],
    ['expired', {}],
    ['completed', { signed: true }],
    ['awaiting_signature', { live: true }],
  ])('supports amending a %s ROA', async (status, how) => {
    const { id: rev1 } = seedRevision1({ status });
    if (how.signed) signRevision(rev1);
    if (how.live) sendRevision(rev1);
    const { res } = await amend({ from: rev1 });
    expect(res.statusCode).toBe(200);
    expect(rowOf(rev1).status).toBe(status); // the original's status stays truthful
  });

  it('refuses to amend while a legacy DocuSign envelope is live, but allows it once that is final', async () => {
    const live = seedRevision1({ status: 'awaiting_signature', docusign_envelope_id: 'ds-1', docusign_status: 'sent' });
    const blocked = await amend({ from: live.id });
    expect(blocked.res.statusCode).toBe(409);
    expect(blocked.res.body.error).toBe('legacy_provider_manual_void_required');

    const done = seedRevision1({ status: 'voided', docusign_envelope_id: 'ds-2', docusign_status: 'voided' });
    expect((await amend({ from: done.id })).res.statusCode).toBe(200);
  });

  it('opening and submitting the editor never touches a live signing request', async () => {
    const { id: rev1 } = seedRevision1({ status: 'awaiting_signature' });
    const envelopeId = sendRevision(rev1);
    const before = rowOf(rev1);

    const open = await getAs(ANDREW, rev1, { view: 'amendment' });
    expect(open.statusCode).toBe(200);
    const submitted = await amend({ from: rev1 });
    expect(submitted.res.statusCode).toBe(200);

    expect(fake.calls).toEqual([]); // not one provider call
    expect(fake.envelope(envelopeId).status).toBe('PENDING');
    expect(fake.liveEnvelopes()).toHaveLength(1);
    expect(withoutLink(rowOf(rev1))).toEqual(withoutLink(before)); // still awaiting, still live
    expect(rowOf(rev1).status).toBe('awaiting_signature');
  });
});

// ---------------------------------------------------------------------------------------
describe('retries, double clicks and two tabs', () => {
  it('two tabs amending the same ROA: exactly one revision wins, the other is refused', async () => {
    const { id: rev1 } = seedRevision1();
    const [a, b] = await Promise.all([amend({ from: rev1 }), amend({ from: rev1 })]);
    const codes = [a.res.statusCode, b.res.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const loser = a.res.statusCode === 409 ? a : b;
    expect(loser.res.body.error).toBe('already_superseded');
    const revisions = mock.fixtures.allRows().filter((r) => r.supersedes_submission_id === rev1);
    expect(revisions).toHaveLength(1);
    expect(rowOf(rev1).superseded_by_submission_id).toBe(revisions[0].id);
  });

  it('a double click with the same revision id and bytes converges on one revision', async () => {
    const { id: rev1 } = seedRevision1();
    const submissionId = generateSubmissionId();
    const bytes = pdf('same-bytes');
    const [a, b] = await Promise.all([
      amend({ from: rev1, submissionId, bytes }),
      amend({ from: rev1, submissionId, bytes }),
    ]);
    expect([a.res.statusCode, b.res.statusCode]).toEqual([200, 200]);
    expect(mock.fixtures.allRows().filter((r) => r.supersedes_submission_id === rev1)).toHaveLength(1);
    expect(rowOf(rev1).superseded_by_submission_id).toBe(submissionId);
  });

  it('a retry after the response was lost reconciles instead of duplicating', async () => {
    const { id: rev1 } = seedRevision1();
    const submissionId = generateSubmissionId();
    const bytes = pdf('lost-response');

    mock.fixtures.loseNextRpcResponse(); // the transaction commits; the caller never hears
    const first = await amend({ from: rev1, submissionId, bytes });
    expect(first.res.statusCode).toBe(500);
    expect(rowOf(submissionId)).toBeTruthy();

    const retry = await amend({ from: rev1, submissionId, bytes });
    expect(retry.res.statusCode).toBe(200);
    expect(retry.res.body.reconciled).toBe(true);
    expect(mock.fixtures.allRows().filter((r) => r.supersedes_submission_id === rev1)).toHaveLength(1);
  });

  it('a definite failure before the commit leaves no row, and the same retry then succeeds', async () => {
    const { id: rev1 } = seedRevision1();
    const submissionId = generateSubmissionId();
    const bytes = pdf('definite-failure');

    mock.fixtures.failNextRpc();
    const first = await amend({ from: rev1, submissionId, bytes });
    expect(first.res.statusCode).toBe(500);
    expect(rowOf(submissionId)).toBeNull();
    expect(rowOf(rev1).superseded_by_submission_id ?? null).toBeNull();
    // The canonical object from the failed attempt is deterministic, so the retry reuses it.
    expect(mock.fixtures.getStorage(`${submissionId}/canonical.pdf`)).toBeTruthy();

    const retry = await amend({ from: rev1, submissionId, bytes });
    expect(retry.res.statusCode).toBe(200);
    expect(rowOf(rev1).superseded_by_submission_id).toBe(submissionId);
  });

  it('refuses a reused revision id carrying different content (409) without touching the first', async () => {
    const { id: rev1 } = seedRevision1();
    const submissionId = generateSubmissionId();
    const first = await amend({ from: rev1, submissionId, bytes: pdf('one') });
    expect(first.res.statusCode).toBe(200);
    const stored = mock.fixtures.getStorage(`${submissionId}/canonical.pdf`);

    const clash = await amend({ from: rev1, submissionId, bytes: pdf('two') });
    expect(clash.res.statusCode).toBe(409);
    expect(mock.fixtures.getStorage(`${submissionId}/canonical.pdf`).equals(stored)).toBe(true);
    expect(rowOf(submissionId).pdf_sha256).toBe(sha256HexOfBytes(pdf('one')));
  });
});

// ---------------------------------------------------------------------------------------
describe('owner-only amendment source', () => {
  it('returns the frozen snapshot to its owner, uncached, and nowhere else', async () => {
    const { id } = seedRevision1();

    const res = await getAs(ANDREW, id, { view: 'amendment' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.amendment).toMatchObject({
      submissionId: id, roaType: 'Personal', revisionNo: 1, nextRevisionNo: 2,
      willCancelSigningRequest: false,
    });
    expect(res.body.amendment.snapshot).toEqual(PERSONAL);

    // The normal get and list never carry the snapshot (or the banking sentinel inside it).
    const plain = await getAs(ANDREW, id);
    expect(JSON.stringify(plain.body)).not.toContain('ACCT-SENTINEL');
    expect(plain.body.submission.amendable).toBe(true);
    const listRes = mockRes();
    await listHandler({ method: 'GET', headers: bearer(ANDREW), query: {} }, listRes);
    expect(JSON.stringify(listRes.body)).not.toContain('ACCT-SENTINEL');
    expect(JSON.stringify(listRes.body)).not.toContain('snapshot');
  });

  it('is 401 without a session, 403 for an unlisted user and 404 for another broker', async () => {
    const { id } = seedRevision1();
    const none = mockRes();
    await getHandler({ method: 'GET', headers: {}, query: { id, view: 'amendment' } }, none);
    expect(none.statusCode).toBe(401);
    expect((await getAs(STRANGER, id, { view: 'amendment' })).statusCode).toBe(403);
    const other = await getAs(WERNER, id, { view: 'amendment' });
    expect(other.statusCode).toBe(404);
    expect(JSON.stringify(other.body)).not.toContain('ACCT-SENTINEL');
  });

  it('refuses a superseded revision and a live legacy envelope, leaking no snapshot', async () => {
    const { id: rev1 } = seedRevision1();
    await amend({ from: rev1 });
    const superseded = await getAs(ANDREW, rev1, { view: 'amendment' });
    expect(superseded.statusCode).toBe(409);
    expect(superseded.body.error).toBe('already_superseded');
    expect(JSON.stringify(superseded.body)).not.toContain('ACCT-SENTINEL');

    const legacy = seedRevision1({ status: 'awaiting_signature', docusign_envelope_id: 'ds-9' });
    const blocked = await getAs(ANDREW, legacy.id, { view: 'amendment' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.error).toBe('legacy_provider_manual_void_required');
  });

  it('warns that sending will cancel a live request, without cancelling anything', async () => {
    const { id } = seedRevision1({ status: 'awaiting_signature' });
    sendRevision(id);
    const res = await getAs(ANDREW, id, { view: 'amendment' });
    expect(res.body.amendment.willCancelSigningRequest).toBe(true);
    expect(fake.calls).toEqual([]);
  });

  it('shows the whole chain in the register, each revision with its own state', async () => {
    const { id: rev1 } = seedRevision1();
    signRevision(rev1);
    const second = await amend({ from: rev1, reason: 'client_information_changed', reasonDetail: 'Moved' });
    const res = mockRes();
    await listHandler({ method: 'GET', headers: bearer(ANDREW), query: {} }, res);
    const byId = Object.fromEntries(res.body.submissions.map((s) => [s.submissionId, s]));

    expect(byId[rev1]).toMatchObject({
      status: 'completed', hasSignedPdf: true, revisionNo: 1, isCurrentRevision: false,
      supersededBySubmissionId: second.submissionId, amendable: false, amendBlockReason: 'already_superseded',
    });
    expect(byId[second.submissionId]).toMatchObject({
      status: 'submitted', revisionNo: 2, isCurrentRevision: true, supersedesSubmissionId: rev1,
      parentSubmissionId: rev1, amendmentReason: 'client_information_changed',
      amendmentReasonDetail: 'Moved', amendedBy: 'andrew@hrsinsurance.co.za', amendable: true,
      hasSignedPdf: false,
    });
  });

  it('keeps the original signed evidence downloadable after it is superseded', async () => {
    const { id: rev1 } = seedRevision1();
    signRevision(rev1);
    await amend({ from: rev1 });
    const pdfHandler = (await import('../api/roa-submissions/pdf.js')).default;
    for (const kind of ['canonical', 'signed', 'certificate', 'audit-log']) {
      const res = mockRes();
      await pdfHandler({ method: 'GET', headers: bearer(ANDREW), query: { id: rev1, kind } }, res);
      expect(res.statusCode, kind).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------------------
describe('replacement gate — nothing is distributed until the previous request is verified not live', () => {
  async function pair({ prior = 'submitted', signed = false, live = false, partial = false, envelopeStatus = 'PENDING', signedPriorPassed = false } = {}) {
    const { id: rev1 } = seedRevision1({ status: prior, snapshot: { ...PERSONAL } });
    if (signed) signRevision(rev1);
    let envelopeId = null;
    if (live) {
      envelopeId = sendRevision(rev1, { envelopeStatus, status: prior });
      if (partial) fake.signRecipient(envelopeId, 1);
    }
    const second = await amend({ from: rev1 });
    expect(second.res.statusCode).toBe(200);
    if (signedPriorPassed) expect(rowOf(rev1).status).toBe('completed');
    return { rev1, rev2: second.submissionId, envelopeId };
  }

  const created = () => fake.callsTo('POST', '/envelope/create');
  const deletes = () => fake.callsTo('POST', '/envelope/delete');
  const unsent = (rev2) => {
    expect(created()).toHaveLength(0);
    expect(rowOf(rev2).signing_envelope_id ?? null).toBeNull();
    expect(rowOf(rev2).status).toBe('submitted');
  };

  it.each([
    ['never sent', { prior: 'submitted' }],
    ['a failed send', { prior: 'signature_failed' }],
    ['declined', { prior: 'declined' }],
    ['voided', { prior: 'voided' }],
    ['expired', { prior: 'expired' }],
  ])('sends the replacement straight away when the previous revision is %s (nothing to cancel)', async (_name, setup) => {
    const { rev1, rev2 } = await pair(setup);
    const res = await send(rev2);
    expect(res.statusCode).toBe(200);
    expect(deletes()).toHaveLength(0);
    expect(fake.liveEnvelopes()).toHaveLength(1);
    expect(fake.liveEnvelopes()[0].externalId).toBe(rev2);
    expect(rowOf(rev1).status).toBe(setup.prior);
    expect(rowOf(rev2)).toMatchObject({ status: 'awaiting_signature', signing_provider: 'documenso' });
  });

  it('sends the replacement of a SIGNED revision without touching the signed record', async () => {
    const { rev1, rev2 } = await pair({ prior: 'completed', signed: true });
    const before = rowOf(rev1);
    const res = await send(rev2);
    expect(res.statusCode).toBe(200);
    expect(deletes()).toHaveLength(0);
    expect(withoutLink(rowOf(rev1))).toEqual(withoutLink(before));
    expect(rowOf(rev1).status).toBe('completed');
    expect(fake.liveEnvelopes()).toHaveLength(1);
  });

  it('cancels the old request, VERIFIES it, and only then creates the replacement — never two live', async () => {
    const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
    const res = await send(rev2);
    expect(res.statusCode).toBe(200);

    const order = fake.calls.map((c) => `${c.method} ${c.path}`);
    const del = order.indexOf('POST /envelope/delete');
    const verify = order.indexOf(`GET /envelope/${envelopeId}`, del);
    const create = order.indexOf('POST /envelope/create');
    expect(del).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(del); // re-read after the delete
    expect(create).toBeGreaterThan(verify); // replacement only after verification
    expect(order.indexOf('POST /envelope/distribute')).toBeGreaterThan(verify);

    expect(fake.liveEnvelopes()).toHaveLength(1);
    expect(fake.liveEnvelopes()[0].externalId).toBe(rev2);
    const old = rowOf(rev1);
    expect(old).toMatchObject({ status: 'voided', signing_status: 'cancelled' });
    expect(old.signing_meta.supersession).toMatchObject({
      replacementId: rev2, observedStatus: 'PENDING', verifiedBy: 'gone',
    });
    expect(old.signing_meta.supersession.cancelRequestedAt).toBeTruthy();
    expect(old.signing_meta.supersession.cancelledAt).toBeTruthy();
    // Recipient progress is recorded without any personal data.
    expect(JSON.stringify(old.signing_meta)).not.toMatch(/@/);
    // Its canonical PDF and snapshot are still exactly as submitted.
    expect(old.snapshot_json).toEqual(PERSONAL);
    expect(old.pdf_sha256).toBe(sha256HexOfBytes(mock.fixtures.getStorage(`${rev1}/canonical.pdf`)));
  });

  it('keeps a copy of the audit log of a partially signed request before withdrawing it', async () => {
    const { rev1, rev2 } = await pair({ prior: 'awaiting_signature', live: true, partial: true });
    expect((await send(rev2)).statusCode).toBe(200);
    const meta = rowOf(rev1).signing_meta.supersession;
    expect(meta.recipients.find((r) => r.signingOrder === 1).signingStatus).toBe('SIGNED');
    expect(meta.auditLog.path).toBe(`${rev1}/superseded-audit-log.pdf`);
    const stored = mock.fixtures.getStorage(meta.auditLog.path);
    expect(sha256HexOfBytes(stored)).toBe(meta.auditLog.sha256);
    // It is a separate object: the (never-created) completed-request audit log is untouched.
    expect(mock.fixtures.getStorage(`${rev1}/audit-log.pdf`)).toBeNull();
    expect(rowOf(rev1).audit_log_storage_path ?? null).toBeNull();
  });

  it('withdraws a never-distributed DRAFT envelope too', async () => {
    const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true, envelopeStatus: 'DRAFT' });
    expect((await send(rev2)).statusCode).toBe(200);
    expect(fake.envelope(envelopeId).deleted).toBe(true);
    expect(rowOf(rev1).status).toBe('voided');
    expect(fake.liveEnvelopes()).toHaveLength(1);
  });

  describe('a signature completing while the amendment is in flight', () => {
    it('already completed when the send starts: reconciles it as the signed record, cancels nothing, blocks once', async () => {
      const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
      fake.complete(envelopeId);

      const blocked = await send(rev2);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.body.error).toBe('predecessor_completed');
      expect(blocked.body.predecessor).toMatchObject({ status: 'completed', hasSignedPdf: true, hasCertificate: true, hasAuditLog: true });
      expect(deletes()).toHaveLength(0);
      unsent(rev2);
      expect(rowOf(rev1)).toMatchObject({ status: 'completed' });
      expect(rowOf(rev1).completed_at).toBeTruthy();

      // The broker consciously re-confirms; the signed predecessor needs no cancelling.
      const again = await send(rev2);
      expect(again.statusCode).toBe(200);
      expect(deletes()).toHaveLength(0);
      expect(rowOf(rev1).status).toBe('completed');
      expect(fake.envelope(envelopeId).deleted).toBe(false);
    });

    it('completing between the check and the cancel: the stale cancellation is abandoned', async () => {
      const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
      fake.override(
        (c) => c.method === 'POST' && c.path === '/envelope/delete',
        () => { fake.complete(envelopeId); return fake.json({ message: 'Document already completed' }, 400); },
      );
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_completed');
      unsent(rev2);
      const old = rowOf(rev1);
      expect(old.status).toBe('completed'); // not voided
      expect(old.signed_pdf_storage_path).toBe(`${rev1}/signed.pdf`);
      expect(fake.liveEnvelopes()).toHaveLength(0);
    });
  });

  describe('fails closed on any provider doubt', () => {
    it('delete answers 500 and the envelope is still live → blocked, then a clean retry succeeds', async () => {
      const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
      fake.override((c) => c.method === 'POST' && c.path === '/envelope/delete', () => fake.json({ message: 'boom' }, 500));

      const first = await send(rev2);
      expect(first.statusCode).toBe(503);
      expect(first.body).toMatchObject({ error: 'predecessor_cancel_unverified', retryable: true });
      unsent(rev2);
      expect(rowOf(rev1).status).toBe('awaiting_signature'); // not voided on a guess
      const firstIntent = rowOf(rev1).signing_meta.supersession.cancelRequestedAt;
      expect(firstIntent).toBeTruthy();

      const retry = await send(rev2);
      expect(retry.statusCode).toBe(200);
      expect(fake.envelope(envelopeId).deleted).toBe(true);
      expect(rowOf(rev1).status).toBe('voided');
      expect(rowOf(rev1).signing_meta.supersession.cancelRequestedAt).toBe(firstIntent);
      expect(fake.liveEnvelopes()).toHaveLength(1);
    });

    it('delete answers 500 but really worked → accepted only because the re-read proves it', async () => {
      const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
      fake.override((c) => c.method === 'POST' && c.path === '/envelope/delete', () => {
        fake.envelope(envelopeId).deleted = true;
        return fake.json({ message: 'gateway timeout' }, 500);
      });
      expect((await send(rev2)).statusCode).toBe(200);
      expect(rowOf(rev1).status).toBe('voided');
      expect(fake.liveEnvelopes()).toHaveLength(1);
    });

    it('delete is refused (403) → blocked with a definite reason', async () => {
      const { rev1, rev2 } = await pair({ prior: 'awaiting_signature', live: true });
      fake.override((c) => c.method === 'POST' && c.path === '/envelope/delete', () => fake.json({ message: 'forbidden' }, 403));
      const res = await send(rev2);
      expect(res.statusCode).toBe(502);
      expect(res.body.error).toBe('predecessor_cancel_rejected');
      unsent(rev2);
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });

    it('delete claims success but the envelope is still live → a success response is not proof', async () => {
      const { rev1, rev2 } = await pair({ prior: 'awaiting_signature', live: true });
      fake.override((c) => c.method === 'POST' && c.path === '/envelope/delete', () => fake.json({ success: true }));
      const res = await send(rev2);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe('predecessor_cancel_unverified');
      unsent(rev2);
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });

    it('cannot re-read the envelope after the delete → unverified, replacement stays unsent', async () => {
      const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
      let reads = 0;
      fake.override(
        (c) => c.method === 'GET' && c.path === `/envelope/${envelopeId}` && (reads += 1) === 2,
        () => { throw new Error('network down'); },
      );
      const res = await send(rev2);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe('predecessor_cancel_unverified');
      unsent(rev2);
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });

    it('cannot read the previous request at all → blocked before anything is cancelled', async () => {
      const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
      fake.override((c) => c.method === 'GET' && c.path === `/envelope/${envelopeId}`, () => fake.json({ message: 'down' }, 500));
      const res = await send(rev2);
      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe('predecessor_status_unavailable');
      expect(deletes()).toHaveLength(0);
      unsent(rev2);
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });

    it('a 404 we cannot explain is not taken as cancelled', async () => {
      const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
      fake.envelope(envelopeId).deleted = true; // gone, but we never asked for that
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_unverifiable');
      expect(deletes()).toHaveLength(0);
      unsent(rev2);
      expect(rowOf(rev1).status).toBe('awaiting_signature');
    });

    it('a 404 after OUR recorded intent (we crashed after the provider acted) is accepted and finalised', async () => {
      const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
      mock.fixtures.putRow(rev1, {
        signing_meta: { externalId: rev1, supersession: { replacementId: rev2, cancelRequestedAt: '2026-10-29T08:00:00.000Z' } },
      });
      fake.envelope(envelopeId).deleted = true;
      const res = await send(rev2);
      expect(res.statusCode).toBe(200);
      expect(rowOf(rev1)).toMatchObject({ status: 'voided', signing_status: 'cancelled' });
      expect(rowOf(rev1).signing_meta.supersession.verifiedBy).toBe('not_found_after_requested_cancel');
      expect(fake.liveEnvelopes()).toHaveLength(1);
    });

    it('treats a predecessor the provider reports as declined or cancelled as not live', async () => {
      for (const [providerStatus, expected] of [['REJECTED', 'declined'], ['CANCELLED', 'voided']]) {
        mock.fixtures.reset();
        mock.fixtures.addAuthUser(ANDREW, { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
        fake = makeFakeDocumenso();
        const { rev1, rev2 } = await pair({ prior: 'awaiting_signature', live: true, envelopeStatus: providerStatus });
        expect((await send(rev2)).statusCode).toBe(200);
        expect(deletes()).toHaveLength(0);
        expect(rowOf(rev1).status).toBe(expected);
      }
    });

    it('does not recognise an unknown provider status → blocked', async () => {
      const { rev2 } = await pair({ prior: 'awaiting_signature', live: true, envelopeStatus: 'WEIRD' });
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_status_unrecognised');
      unsent(rev2);
    });

    it('refuses to proceed past a live legacy DocuSign envelope it cannot cancel', async () => {
      const { id: rev1 } = seedRevision1({ status: 'voided', docusign_envelope_id: 'ds-1', docusign_status: 'voided' });
      const second = await amend({ from: rev1 });
      expect(second.res.statusCode).toBe(200);
      // The legacy envelope comes alive again (e.g. a manual resend in DocuSign) before sending.
      mock.fixtures.putRow(rev1, { status: 'awaiting_signature', docusign_status: 'sent' });
      const res = await send(second.submissionId);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_provider_unsupported');
      expect(fake.calls).toEqual([]);
      unsent(second.submissionId);
    });
  });

  describe('a previous send that never recorded an envelope', () => {
    it('a reservation that may still be in flight blocks the replacement', async () => {
      const { rev1, rev2 } = await pair({ prior: 'awaiting_signature' });
      mock.fixtures.putRow(rev1, {
        signing_provider: 'documenso', sent_for_signature_at: new Date().toISOString(),
      });
      const res = await send(rev2);
      expect(res.statusCode).toBe(409);
      expect(res.body.error).toBe('predecessor_send_in_progress');
      expect(fake.calls).toEqual([]);
      unsent(rev2);
    });

    it('a stale reservation with nothing at the provider is released and the replacement is sent', async () => {
      const { rev1, rev2 } = await pair({ prior: 'awaiting_signature' });
      mock.fixtures.putRow(rev1, { signing_provider: 'documenso', sent_for_signature_at: '2026-09-01T09:00:00.000Z' });
      const res = await send(rev2);
      expect(res.statusCode).toBe(200);
      expect(rowOf(rev1).status).toBe('signature_failed');
      expect(deletes()).toHaveLength(0);
      expect(fake.liveEnvelopes()).toHaveLength(1);
    });

    it('a stale reservation whose envelope DID get created is adopted, cancelled and replaced', async () => {
      const { rev1, rev2 } = await pair({ prior: 'awaiting_signature' });
      mock.fixtures.putRow(rev1, { signing_provider: 'documenso', sent_for_signature_at: '2026-09-01T09:00:00.000Z' });
      const orphan = fake.seedEnvelope({ id: 'env-orphan', externalId: rev1, status: 'PENDING' });
      const res = await send(rev2);
      expect(res.statusCode).toBe(200);
      expect(orphan.deleted).toBe(true);
      expect(rowOf(rev1)).toMatchObject({ status: 'voided', signing_envelope_id: 'env-orphan' });
      expect(fake.liveEnvelopes()).toHaveLength(1);
      expect(fake.liveEnvelopes()[0].externalId).toBe(rev2);
    });
  });

  it('a double click / two tabs sending the replacement still yields exactly one live envelope', async () => {
    const { rev1, rev2 } = await pair({ prior: 'awaiting_signature', live: true });
    const [a, b] = await Promise.all([send(rev2), send(rev2)]);
    expect([a.statusCode, b.statusCode].some((code) => code === 200)).toBe(true);
    for (const res of [a, b]) expect([200, 409]).toContain(res.statusCode);
    expect(created()).toHaveLength(1);
    expect(fake.liveEnvelopes()).toHaveLength(1);
    expect(fake.liveEnvelopes()[0].externalId).toBe(rev2);
    expect(rowOf(rev1).status).toBe('voided');
    // A later retry is an idempotent no-op.
    const later = await send(rev2);
    expect(later.statusCode).toBe(200);
    expect(created()).toHaveLength(1);
  });

  it('never sends a revision that has itself been superseded', async () => {
    const { rev1, rev2 } = await pair({ prior: 'submitted' });
    const third = await amend({ from: rev2, reason: 'spelling_correction' });
    expect(third.res.statusCode).toBe(200);
    const res = await send(rev2);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('submission_superseded');
    expect(fake.calls).toEqual([]);
    unsent(rev2);
    // ...and the original, never sent either, cannot be sent behind the chain's back.
    const stale = await send(rev1);
    expect(stale.statusCode).toBe(409);
    expect(stale.body.error).toBe('submission_superseded');
    expect(fake.calls).toEqual([]);
  });

  it('does not let a second broker trigger the gate on someone else\'s chain', async () => {
    const { rev1, rev2 } = await pair({ prior: 'awaiting_signature', live: true });
    const res = await send(rev2, WERNER);
    expect(res.statusCode).toBe(404);
    expect(fake.calls).toEqual([]);
    expect(rowOf(rev1).status).toBe('awaiting_signature');
  });

  it('stops nudging a client to sign a request that is being replaced', async () => {
    const { rev1 } = await pair({ prior: 'awaiting_signature', live: true });
    const res = mockRes();
    await reminderHandler({ method: 'POST', headers: bearer(ANDREW), body: { submissionId: rev1 } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('submission_superseded');
    expect(fake.callsTo('POST', '/envelope/redistribute')).toHaveLength(0);
  });

  it('a refresh after a crash that followed our own cancel marks the old request voided; an unexplained 404 stays an error', async () => {
    const { rev1, rev2, envelopeId } = await pair({ prior: 'awaiting_signature', live: true });
    fake.envelope(envelopeId).deleted = true;

    const unexplained = mockRes();
    await refreshHandler({ method: 'POST', headers: bearer(ANDREW), body: { submissionId: rev1 } }, unexplained);
    expect(unexplained.statusCode).toBeGreaterThanOrEqual(400);
    expect(rowOf(rev1).status).toBe('awaiting_signature');

    mock.fixtures.putRow(rev1, {
      signing_meta: { externalId: rev1, supersession: { replacementId: rev2, cancelRequestedAt: '2026-10-29T08:00:00.000Z' } },
    });
    const explained = mockRes();
    await refreshHandler({ method: 'POST', headers: bearer(ANDREW), body: { submissionId: rev1 } }, explained);
    expect(explained.statusCode).toBe(200);
    expect(rowOf(rev1)).toMatchObject({ status: 'voided', signing_status: 'cancelled' });
  });

  it('a signed original stays "last signed" while its replacement awaits signature', async () => {
    const { rev1, rev2 } = await pair({ prior: 'completed', signed: true });
    expect((await send(rev2)).statusCode).toBe(200);
    const res = mockRes();
    await listHandler({ method: 'GET', headers: bearer(ANDREW), query: {} }, res);
    const byId = Object.fromEntries(res.body.submissions.map((s) => [s.submissionId, s]));
    expect(byId[rev1]).toMatchObject({ status: 'completed', hasSignedPdf: true, hasCertificate: true, hasAuditLog: true });
    expect(byId[rev2]).toMatchObject({ status: 'awaiting_signature', hasSignedPdf: false });
    expect(byId[rev2].signingEnvelopeId).not.toBe(byId[rev1].signingEnvelopeId);
  });
});
