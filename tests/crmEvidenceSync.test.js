// ROA → CRM evidence sync contract: signed ROA + certificate + (Documenso) audit log.
// Uses the in-memory Supabase mock and a stubbed fetch; no external network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMockSupabase } from './testUtils/mockSupabase.js';

const mock = makeMockSupabase();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mock.client }));

const createHandler = (await import('../api/roa-submissions/create.js')).default;
const syncCrmHandler = (await import('../api/roa-submissions/sync-crm.js')).default;
const { maybeSyncCompletedSubmissionToCrm } = await import('../api/_lib/crmIntegration.js');
const { isCrmEvidenceComplete } = await import('../api/_lib/signingLifecycle.js');
const { loadSubmissionRaw } = await import('../api/_lib/submissionRepo.js');
const { _resetServerSupabaseForTests, StoragePaths } = await import('../api/_lib/supabaseServer.js');
const { generateSubmissionId } = await import('../src/lib/roaSubmissionSnapshot.js');
const { sha256HexOfBytes } = await import('../api/_lib/sha256.js');

const originalEnv = { ...process.env };

function mockRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send() { return this; },
  };
}

const pdf = (marker) => Buffer.from(`%PDF-1.4\n${marker}\n${'x'.repeat(600)}\n%%EOF`);

async function seedCompleted({ provider = 'documenso', withAudit = true } = {}) {
  const submissionId = generateSubmissionId();
  const res = mockRes();
  await createHandler({
    method: 'POST',
    headers: { authorization: 'Bearer token-andrew' },
    body: {
      submissionId,
      roaType: 'Personal',
      snapshot: {
        firstName: 'Jane', surname: 'Doe', initials: 'J', idNumber: '9001010000000',
        brokerName: 'Andrew Penney', recInsurer: 'Stratsys', prem2: '2000',
      },
      versions: {
        templateVersion: 'T', statutoryDisclosureVersion: 'S',
        brokerAppointmentVersion: 'A', brokerFeeVersion: 'F',
      },
      pdfBase64: pdf(submissionId).toString('base64'),
    },
  }, res);
  expect(res.statusCode).toBe(200);

  const evidence = {
    signed: pdf(`signed-${submissionId}`),
    certificate: pdf(`certificate-${submissionId}`),
    audit: pdf(`audit-${submissionId}`),
  };
  mock.fixtures.putStorage(StoragePaths.signed(submissionId), evidence.signed);
  mock.fixtures.putStorage(StoragePaths.certificate(submissionId), evidence.certificate);
  const patch = {
    status: 'completed',
    signing_provider: provider,
    signing_envelope_id: 'env-1',
    signing_status: 'completed',
    signed_pdf_storage_path: StoragePaths.signed(submissionId),
    signed_pdf_sha256: sha256HexOfBytes(evidence.signed),
    certificate_storage_path: StoragePaths.certificate(submissionId),
    certificate_sha256: sha256HexOfBytes(evidence.certificate),
  };
  if (withAudit) {
    mock.fixtures.putStorage(StoragePaths.auditLog(submissionId), evidence.audit);
    patch.audit_log_storage_path = StoragePaths.auditLog(submissionId);
    patch.audit_log_sha256 = sha256HexOfBytes(evidence.audit);
  }
  mock.fixtures.putRow(submissionId, patch);
  return { submissionId, evidence };
}

function crmReplies(...replies) {
  const queue = [...replies];
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return { ok: true, status: 200, json: async () => body };
  });
}

const linkedWithAudit = {
  status: 'linked', clientId: 'C-1', dealId: 'D-1',
  signedRoaDocumentId: 'DOC-1', certificateDocumentId: 'DOC-2', auditLogDocumentId: 'DOC-3',
};

async function sync(submissionId) {
  const res = mockRes();
  await syncCrmHandler({
    method: 'POST', headers: { authorization: 'Bearer token-andrew' }, body: { submissionId },
  }, res);
  return res;
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  process.env.CRM_BASE_URL = 'https://crm.example.test';
  process.env.CRM_INTEGRATION_SECRET = 's'.repeat(32);
  _resetServerSupabaseForTests();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.fixtures.addAuthUser('token-andrew', { id: 'user-andrew', email: 'andrew@hrsinsurance.co.za' });
});

afterEach(() => {
  vi.restoreAllMocks();
  mock.fixtures.reset();
  for (const k of Object.keys(process.env)) {
    if (!(k in originalEnv)) delete process.env[k];
  }
  Object.assign(process.env, originalEnv);
});

describe('CRM evidence payload', () => {
  it('sends signed ROA, certificate and audit log with verified hashes for Documenso', async () => {
    const { submissionId, evidence } = await seedCompleted();
    const fetchSpy = crmReplies(linkedWithAudit);
    const res = await sync(submissionId);
    expect(res.statusCode).toBe(200);

    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sent.signingProvider).toBe('documenso');
    expect(sent.evidence.auditLog).toEqual({
      pdfBase64: evidence.audit.toString('base64'), sha256: sha256HexOfBytes(evidence.audit),
    });
    expect(sent.evidence.signedRoa.sha256).toBe(sha256HexOfBytes(evidence.signed));
    expect(sent.evidence.certificate.sha256).toBe(sha256HexOfBytes(evidence.certificate));
    // Submission id stays available to the CRM as metadata (tags / receipt).
    expect(sent.submissionId).toBe(submissionId);

    const row = mock.fixtures.getRow(submissionId);
    expect(row).toMatchObject({
      crm_sync_status: 'linked', crm_signed_roa_document_id: 'DOC-1',
      crm_certificate_document_id: 'DOC-2', crm_audit_log_document_id: 'DOC-3',
    });
    expect(res.body.submission.crmAuditLogDocumentId).toBe('DOC-3');
  });

  it('keeps the two-document contract for DocuSign (no audit log exists)', async () => {
    const { submissionId } = await seedCompleted({ provider: 'docusign', withAudit: false });
    const fetchSpy = crmReplies({
      status: 'linked', clientId: 'C-1', dealId: 'D-1',
      signedRoaDocumentId: 'DOC-1', certificateDocumentId: 'DOC-2',
    });
    const res = await sync(submissionId);
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sent.signingProvider).toBe('docusign');
    expect(sent.evidence).not.toHaveProperty('auditLog');
    expect(mock.fixtures.getRow(submissionId).crm_sync_status).toBe('linked');
  });

  it('sends no evidence for Documenso until the audit log is stored (no premature linking)', async () => {
    const { submissionId } = await seedCompleted({ withAudit: false });
    const fetchSpy = crmReplies({ status: 'partial', clientId: 'C-1', dealId: 'D-1' });
    await sync(submissionId);
    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sent).not.toHaveProperty('evidence');
    expect(mock.fixtures.getRow(submissionId).crm_sync_status).toBe('partial');
  });

  it('hash mismatch on the audit log fails safely before anything leaves the server', async () => {
    const { submissionId } = await seedCompleted();
    mock.fixtures.putStorage(StoragePaths.auditLog(submissionId), pdf('tampered'));
    const fetchSpy = crmReplies(linkedWithAudit);
    const res = await sync(submissionId);
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('evidence_hash_mismatch');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mock.fixtures.getRow(submissionId)).toMatchObject({
      crm_sync_status: 'failed', crm_sync_error: 'evidence_hash_mismatch',
    });
    expect(mock.fixtures.getRow(submissionId).crm_audit_log_document_id).toBeUndefined();
  });

  it('does not accept `linked` for Documenso when the CRM did not file the audit log', async () => {
    const { submissionId } = await seedCompleted();
    crmReplies({ ...linkedWithAudit, auditLogDocumentId: null });
    const res = await sync(submissionId);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('crm_response_invalid');
    expect(mock.fixtures.getRow(submissionId).crm_sync_status).toBe('failed');
  });
});

describe('CRM evidence scope', () => {
  it('only ever sends authoritative stored signing artefacts (never the canonical draft or a browser checklist)', async () => {
    const { submissionId } = await seedCompleted();
    const fetchSpy = crmReplies(linkedWithAudit);
    await sync(submissionId);
    const sent = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(Object.keys(sent.evidence).sort()).toEqual(['auditLog', 'certificate', 'signedRoa']);
    expect(JSON.stringify(sent)).not.toMatch(/checklist|canonical/i);
  });
});

describe('CRM sync completion and idempotency', () => {
  it('treats Documenso as complete only once the audit log document id is recorded', () => {
    expect(isCrmEvidenceComplete({ signing_provider: 'documenso', crm_sync_status: 'linked' })).toBe(false);
    expect(isCrmEvidenceComplete({
      signing_provider: 'documenso', crm_sync_status: 'linked', crm_audit_log_document_id: 'DOC-3',
    })).toBe(true);
    expect(isCrmEvidenceComplete({ signing_provider: 'docusign', crm_sync_status: 'linked' })).toBe(true);
    expect(isCrmEvidenceComplete({
      signing_provider: 'documenso', crm_sync_status: 'partial', crm_audit_log_document_id: 'DOC-3',
    })).toBe(false);
  });

  it('automatic post-completion sync does not call the CRM again once fully linked', async () => {
    const { submissionId } = await seedCompleted();
    const fetchSpy = crmReplies(linkedWithAudit);
    await sync(submissionId);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const row = await loadSubmissionRaw(submissionId);
    await maybeSyncCompletedSubmissionToCrm(row);
    await maybeSyncCompletedSubmissionToCrm(row);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a retry after a CRM failure re-sends and records the audit log document once', async () => {
    const { submissionId } = await seedCompleted();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('network down'));
    expect((await sync(submissionId)).statusCode).toBe(502);
    expect(mock.fixtures.getRow(submissionId).crm_sync_status).toBe('failed');
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = crmReplies(linkedWithAudit);
    expect((await sync(submissionId)).statusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mock.fixtures.getRow(submissionId).crm_audit_log_document_id).toBe('DOC-3');
  });

  it('backfills the audit log for a Documenso row linked before audit logs were synced, then stops', async () => {
    const { submissionId } = await seedCompleted();
    mock.fixtures.putRow(submissionId, {
      crm_sync_status: 'linked', crm_client_id: 'C-1', crm_deal_id: 'D-1',
      crm_signed_roa_document_id: 'DOC-1', crm_certificate_document_id: 'DOC-2',
    });
    const fetchSpy = crmReplies(linkedWithAudit);
    const legacy = await loadSubmissionRaw(submissionId);
    const after = await maybeSyncCompletedSubmissionToCrm(legacy);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(after.crm_audit_log_document_id).toBe('DOC-3');
    await maybeSyncCompletedSubmissionToCrm(after);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
