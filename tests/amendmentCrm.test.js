// Amend ROA (Issue #8) — CRM evidence for revisions.
//
// The deployed CRM validates its payload strictly (unknown fields are rejected), so
// revision metadata is only sent once the CRM release that understands it is live and
// CRM_REVISION_METADATA=enabled. Until then revisions are DEFERRED without touching any
// sync state, and revision 1 behaves exactly as before. Once enabled, each revision files
// its own signed ROA + certificate + audit log under its own submission id, idempotently,
// and never disturbs the CRM documents already filed for an earlier revision.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';
import { TEST_TOKENS } from './testUtils/testJwt.js';
import { sha256HexOfBytes } from '../api/_lib/sha256.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));

const crm = await import('../api/_lib/crmIntegration.js');
const syncCrmHandler = (await import('../api/roa-submissions/sync-crm.js')).default;
const { _resetServerSupabaseForTests } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');

const originalEnv = { ...process.env };
let posts;

const pdf = (marker) => Buffer.from(`%PDF-1.4\n${marker}\n${'x'.repeat(600)}\n%%EOF`, 'utf8');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const PERSONAL = {
  firstName: 'Jane', surname: 'Doe', initials: 'J', idNumber: '8001015009087', email: 'jane@example.com',
  cell: '0821234567', brokerName: 'Andrew Penney', recInsurer: 'Stratsys', prem2: '1500',
};
const COMMERCIAL = {
  companyName: 'ACME Pty Ltd', registrationNo: '2020/123456/07', vatNo: '4123456789',
  contactPerson: 'Alex Rivera', email: 'alex@acme.example', contactNo: '0211234567', brokerName: 'Andrew Penney',
};

function seedSigned({ roaType = 'Personal', snapshot, revisionNo = 1, parent = null, supersedes = null, crmFields = {} } = {}) {
  const id = generateSubmissionId();
  const canonical = pdf(`canonical-${id}`);
  const evidence = {};
  for (const [prefix, file] of [['signed_pdf', 'signed'], ['certificate', 'certificate'], ['audit_log', 'audit-log']]) {
    const bytes = pdf(`${file}-${id}`);
    mock.fixtures.putStorage(`${id}/${file}.pdf`, bytes);
    evidence[`${prefix}_storage_path`] = `${id}/${file}.pdf`;
    evidence[`${prefix}_sha256`] = sha256HexOfBytes(bytes);
  }
  mock.fixtures.putStorage(`${id}/canonical.pdf`, canonical);
  const row = {
    id,
    roa_type: roaType,
    status: 'completed',
    advisor_user_id: 'u1',
    advisor_email: 'andrew@hrsinsurance.co.za',
    client_reference: 'ref',
    snapshot_json: snapshot ?? (roaType === 'Personal' ? PERSONAL : COMMERCIAL),
    template_version: 't', statutory_disclosure_version: 's', broker_appointment_version: 'b', broker_fee_version: 'f',
    pdf_sha256: sha256HexOfBytes(canonical),
    pdf_storage_path: `${id}/canonical.pdf`,
    pdf_byte_length: canonical.length,
    submitted_at: '2026-10-01T08:00:00.000Z',
    signing_provider: 'documenso',
    signing_envelope_id: `env-${id.slice(4, 12)}`,
    signing_status: 'completed',
    completed_at: '2026-10-02T10:00:00.000Z',
    revision_no: revisionNo,
    parent_submission_id: parent,
    supersedes_submission_id: supersedes,
    ...(revisionNo > 1 ? {
      amendment_reason: 'client_information_changed',
      amendment_reason_detail: 'Moved — SENSITIVE FREE TEXT',
      amended_by: 'andrew@hrsinsurance.co.za',
      amended_at: '2026-10-03T08:00:00.000Z',
    } : {}),
    ...evidence,
    ...crmFields,
  };
  mock.fixtures.insertRow(row);
  return { id, evidence };
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.CRM_BASE_URL = 'https://crm.example.test';
  process.env.CRM_INTEGRATION_SECRET = 'x'.repeat(40);
  delete process.env.CRM_REVISION_METADATA;
  _resetServerSupabaseForTests();
  mock.fixtures.reset();
  mock.fixtures.addAuthUser(TEST_TOKENS.andrew, { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
  posts = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    const payload = JSON.parse(options.body);
    posts.push({ url: String(url), payload });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          clientId: 'crm-client-1',
          dealId: `crm-deal-for-${payload.submissionId.slice(4, 12)}`,
          status: payload.evidence ? 'linked' : 'partial',
          signedRoaDocumentId: payload.evidence ? `doc-signed-${payload.submissionId.slice(4, 12)}` : null,
          certificateDocumentId: payload.evidence ? `doc-cert-${payload.submissionId.slice(4, 12)}` : null,
          auditLogDocumentId: payload.evidence?.auditLog ? `doc-audit-${payload.submissionId.slice(4, 12)}` : null,
        };
      },
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

describe('payload', () => {
  it.each([
    ['Personal', PERSONAL, { idNumber: '8001015009087' }],
    ['Commercial', COMMERCIAL, { companyRegistration: '2020/123456/07' }],
  ])('a first submission\'s %s payload is unchanged: no revision block', (roaType, snapshot) => {
    const payload = crm.buildCrmSyncPayload({ id: 'ROA-1', roa_type: roaType, advisor_email: 'a@b.co', snapshot_json: snapshot, revision_no: 1 });
    expect('revision' in payload).toBe(false);
    const legacy = crm.buildCrmSyncPayload({ id: 'ROA-1', roa_type: roaType, advisor_email: 'a@b.co', snapshot_json: snapshot });
    expect(payload).toEqual(legacy); // legacy rows carry no revision_no at all
  });

  it.each([
    ['Personal', PERSONAL, { idNumber: '8001015009087', companyRegistration: null }],
    ['Commercial', COMMERCIAL, { companyRegistration: '2020/123456/07', idNumber: null }],
  ])('a revision\'s %s payload adds revision metadata and still identifies the client by ID / registration', (roaType, snapshot, identity) => {
    const row = {
      id: 'ROA-00000002-0000-4000-8000-000000000000', roa_type: roaType, advisor_email: 'andrew@hrsinsurance.co.za',
      snapshot_json: snapshot, revision_no: 2,
      parent_submission_id: 'ROA-00000001-0000-4000-8000-000000000000',
      supersedes_submission_id: 'ROA-00000001-0000-4000-8000-000000000000',
      amendment_reason: 'incorrect_email', amendment_reason_detail: 'SENSITIVE FREE TEXT', amended_at: '2026-10-03T08:00:00.000Z',
    };
    const payload = crm.buildCrmSyncPayload(row);
    expect(payload.revision).toEqual({
      revisionNo: 2,
      parentSubmissionId: 'ROA-00000001-0000-4000-8000-000000000000',
      supersedesSubmissionId: 'ROA-00000001-0000-4000-8000-000000000000',
      amendmentReason: 'incorrect_email',
      amendedAt: '2026-10-03T08:00:00.000Z',
    });
    expect(JSON.stringify(payload)).not.toContain('SENSITIVE');
    expect(payload.submissionId).toBe(row.id);
    expect(payload.client).toMatchObject(identity);
    // Same client section as the same snapshot would produce for a first submission.
    expect(payload.client).toEqual(crm.buildCrmSyncPayload({ ...row, revision_no: 1 }).client);
  });
});

describe('before the CRM supports revisions (flag off — the safe default)', () => {
  it('defers a revision without calling the CRM or writing any sync state', async () => {
    const first = seedSigned();
    const second = seedSigned({ revisionNo: 2, parent: first.id, supersedes: first.id });
    const row = mock.fixtures.getRow(second.id);

    await expect(crm.syncSubmissionToCrm(row)).rejects.toMatchObject({ code: 'crm_revision_sync_not_enabled', status: 409 });
    expect(posts).toHaveLength(0);
    const after = mock.fixtures.getRow(second.id);
    expect(after.crm_sync_status ?? null).toBeNull();
    expect(after.crm_sync_attempted_at ?? null).toBeNull();
    expect(after.crm_sync_error ?? null).toBeNull();

    // The automatic path after evidence retrieval is silent about it, too.
    expect((await crm.maybeSyncCompletedSubmissionToCrm(row)).id).toBe(second.id);
    expect(posts).toHaveLength(0);
    expect(mock.fixtures.getRow(second.id).crm_sync_status ?? null).toBeNull();
  });

  it('answers the manual sync button with a clear 409, not a CRM failure', async () => {
    const first = seedSigned();
    const second = seedSigned({ revisionNo: 2, parent: first.id, supersedes: first.id });
    const res = mockRes();
    await syncCrmHandler({ method: 'POST', headers: { authorization: `Bearer ${TEST_TOKENS.andrew}` }, body: { submissionId: second.id } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('crm_revision_sync_not_enabled');
    expect(res.body.submission).toBeUndefined();
    expect(posts).toHaveLength(0);
  });

  it('does not change how a first submission syncs', async () => {
    const first = seedSigned();
    const row = mock.fixtures.getRow(first.id);
    const updated = await crm.maybeSyncCompletedSubmissionToCrm(row);
    expect(updated.crm_sync_status).toBe('linked');
    expect(posts).toHaveLength(1);
    expect('revision' in posts[0].payload).toBe(false);
    expect(posts[0].payload.submissionId).toBe(first.id);
  });
});

describe('once the CRM supports revisions (CRM_REVISION_METADATA=enabled)', () => {
  beforeEach(() => { process.env.CRM_REVISION_METADATA = 'enabled'; });

  it('files each revision\'s OWN evidence under its own id and leaves the earlier revision\'s CRM documents alone', async () => {
    const first = seedSigned();
    await crm.maybeSyncCompletedSubmissionToCrm(mock.fixtures.getRow(first.id));
    const firstFiled = { ...mock.fixtures.getRow(first.id) };
    expect(firstFiled).toMatchObject({ crm_sync_status: 'linked', crm_signed_roa_document_id: `doc-signed-${first.id.slice(4, 12)}` });

    const second = seedSigned({ revisionNo: 2, parent: first.id, supersedes: first.id });
    const updated = await crm.maybeSyncCompletedSubmissionToCrm(mock.fixtures.getRow(second.id));

    const sent = posts.at(-1).payload;
    expect(sent.submissionId).toBe(second.id);
    expect(sent.revision).toMatchObject({ revisionNo: 2, parentSubmissionId: first.id, supersedesSubmissionId: first.id });
    expect(sent.signingProvider).toBe('documenso');
    // The bytes are this revision's, not the original's.
    expect(sent.evidence.signedRoa.sha256).toBe(second.evidence.signed_pdf_sha256);
    expect(sent.evidence.signedRoa.sha256).not.toBe(first.evidence.signed_pdf_sha256);
    expect(sent.evidence.certificate.sha256).toBe(second.evidence.certificate_sha256);
    expect(sent.evidence.auditLog.sha256).toBe(second.evidence.audit_log_sha256);
    expect(updated).toMatchObject({
      crm_sync_status: 'linked',
      crm_signed_roa_document_id: `doc-signed-${second.id.slice(4, 12)}`,
      crm_certificate_document_id: `doc-cert-${second.id.slice(4, 12)}`,
      crm_audit_log_document_id: `doc-audit-${second.id.slice(4, 12)}`,
    });

    // Append-only: the first revision's filed documents are exactly as they were.
    const firstAfter = mock.fixtures.getRow(first.id);
    for (const key of ['crm_sync_status', 'crm_signed_roa_document_id', 'crm_certificate_document_id',
      'crm_audit_log_document_id', 'crm_synced_at', 'crm_deal_id', 'crm_client_id']) {
      expect(firstAfter[key], key).toEqual(firstFiled[key]);
    }
  });

  it('a retry is idempotent: a linked revision is not re-sent, and an explicit re-sync repeats the same payload', async () => {
    const first = seedSigned();
    const second = seedSigned({ revisionNo: 2, parent: first.id, supersedes: first.id });
    await crm.maybeSyncCompletedSubmissionToCrm(mock.fixtures.getRow(second.id));
    expect(posts).toHaveLength(1);

    await crm.maybeSyncCompletedSubmissionToCrm(mock.fixtures.getRow(second.id));
    expect(posts).toHaveLength(1); // already linked and complete: nothing more to send

    await crm.syncSubmissionToCrm(mock.fixtures.getRow(second.id));
    expect(posts).toHaveLength(2);
    expect(posts[1].payload).toEqual(posts[0].payload); // identical, so the CRM can dedupe by submissionId
  });

  it('syncs a not-yet-signed revision with metadata but no evidence (client and deal only)', async () => {
    const first = seedSigned();
    const id = generateSubmissionId();
    mock.fixtures.insertRow({
      ...mock.fixtures.getRow(first.id), id, status: 'submitted', revision_no: 2, parent_submission_id: first.id,
      supersedes_submission_id: first.id, amendment_reason: 'incorrect_email', amended_by: 'andrew@hrsinsurance.co.za',
      amended_at: '2026-10-03T08:00:00.000Z', signed_pdf_storage_path: null, certificate_storage_path: null,
      audit_log_storage_path: null, signed_pdf_sha256: null, certificate_sha256: null, audit_log_sha256: null,
      crm_sync_status: null, crm_signed_roa_document_id: null, crm_certificate_document_id: null,
      crm_audit_log_document_id: null, crm_deal_id: null, crm_client_id: null, completed_at: null,
    });
    const updated = await crm.syncSubmissionToCrm(mock.fixtures.getRow(id));
    expect(posts.at(-1).payload.evidence).toBeUndefined();
    expect(posts.at(-1).payload.revision.revisionNo).toBe(2);
    expect(updated.crm_sync_status).toBe('partial');
  });
});
