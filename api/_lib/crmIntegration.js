import { downloadPdf, updateSubmission } from './submissionRepo.js';
import { sha256HexOfBytes } from './sha256.js';
import {
  hasRequiredSigningEvidence,
  isCrmEvidenceComplete,
  signingProviderFor,
} from './signingLifecycle.js';

const REQUEST_TIMEOUT_MS = 12_000;

export class CrmSyncError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = 'CrmSyncError';
    this.code = code;
    this.status = status;
  }
}

function text(value) {
  const cleaned = typeof value === 'string' ? value.trim() : value;
  return cleaned === '' || cleaned == null ? null : cleaned;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function buildCrmSyncPayload(row) {
  const snapshot = row.snapshot_json || {};
  const personal = row.roa_type === 'Personal';
  const displayName = personal
    ? [snapshot.initials || snapshot.firstName, snapshot.surname].filter(Boolean).join(' ').trim()
    : text(snapshot.companyName);
  if (!displayName) throw new CrmSyncError('missing_client_identity', 422);
  return {
    submissionId: row.id,
    roaType: row.roa_type,
    adviser: { email: row.advisor_email, name: text(snapshot.brokerName) },
    client: {
      displayName,
      firstName: personal ? text(snapshot.firstName) : null,
      surname: personal ? text(snapshot.surname) : null,
      initials: personal ? text(snapshot.initials) : null,
      idNumber: personal ? text(snapshot.idNumber) : null,
      companyName: personal ? null : text(snapshot.companyName),
      companyRegistration: personal ? null : text(snapshot.registrationNo),
      vatNumber: personal ? null : text(snapshot.vatNo),
      contactPerson: personal ? null : text(snapshot.contactPerson)
        || [snapshot.contactFirstName, snapshot.contactSurname].filter(Boolean).join(' ').trim()
        || null,
      email: text(snapshot.email),
      phone: text(personal ? snapshot.cell : snapshot.contactNo),
      streetAddress: [snapshot.streetNumber, snapshot.streetName].filter(Boolean).join(' ').trim() || null,
      complexNumber: text(snapshot.complexName),
      suburb: text(snapshot.suburb), city: text(snapshot.city),
      province: text(snapshot.province), postalCode: text(snapshot.postalCode),
    },
    deal: {
      policyType: personal ? 'personal' : 'commercial',
      estimatedPremium: numberOrNull(snapshot.prem2),
      insurer: text(snapshot.recInsurer),
      inceptionDate: text(snapshot.inceptionDate),
    },
  };
}

export function verifyEvidenceBytes(bytes, expectedHash) {
  if (!expectedHash) throw new CrmSyncError('missing_evidence_metadata', 409);
  const actualHash = sha256HexOfBytes(bytes);
  if (actualHash !== expectedHash) throw new CrmSyncError('evidence_hash_mismatch', 409);
  return { pdfBase64: bytes.toString('base64'), sha256: expectedHash };
}

async function evidenceItem(path, expectedHash) {
  if (!path) throw new CrmSyncError('missing_evidence_metadata', 409);
  return verifyEvidenceBytes(await downloadPdf(path), expectedHash);
}

export async function buildCrmRequest(row) {
  const payload = buildCrmSyncPayload(row);
  if (!hasRequiredSigningEvidence(row)) return payload;
  const provider = signingProviderFor(row);
  payload.signingProvider = provider === 'documenso' || provider === 'docusign' ? provider : null;
  payload.evidence = {
    signedRoa: await evidenceItem(row.signed_pdf_storage_path, row.signed_pdf_sha256),
    certificate: await evidenceItem(row.certificate_storage_path, row.certificate_sha256),
  };
  // Documenso always produces an audit log (hasRequiredSigningEvidence guarantees it is stored).
  if (provider === 'documenso') {
    payload.evidence.auditLog = await evidenceItem(row.audit_log_storage_path, row.audit_log_sha256);
  }
  return payload;
}

function configuredEndpoint() {
  const baseUrl = process.env.CRM_BASE_URL;
  const secret = process.env.CRM_INTEGRATION_SECRET;
  if (!baseUrl || !secret || secret.length < 32) throw new CrmSyncError('crm_not_configured', 503);
  let endpoint;
  try { endpoint = new URL('/api/integrations/roa-sync', baseUrl); }
  catch { throw new CrmSyncError('crm_base_url_invalid', 503); }
  if (process.env.NODE_ENV === 'production' && endpoint.protocol !== 'https:') {
    throw new CrmSyncError('crm_base_url_insecure', 503);
  }
  return { endpoint, secret };
}

function crmHeaders(secret) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret}`,
  };
  const bypassSecret = process.env.CRM_VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;
  return headers;
}

export async function syncSubmissionToCrm(row) {
  const attemptedAt = new Date().toISOString();
  let current = await updateSubmission(row.id, {
    crm_sync_attempted_at: attemptedAt,
    crm_sync_error: null,
  });
  try {
    const { endpoint, secret } = configuredEndpoint();
    const payload = await buildCrmRequest(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: crmHeaders(secret),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      throw new CrmSyncError(error?.name === 'AbortError' ? 'crm_timeout' : 'crm_unreachable');
    } finally { clearTimeout(timeout); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CrmSyncError(String(data?.error || 'crm_rejected'), response.status);
    if (!data?.clientId || !data?.dealId || !['partial', 'linked'].includes(data?.status)) {
      throw new CrmSyncError('crm_response_invalid');
    }
    if (payload.evidence?.auditLog && data.status === 'linked' && !data.auditLogDocumentId) {
      throw new CrmSyncError('crm_response_invalid');
    }
    const patch = {
      crm_client_id: data.clientId,
      crm_deal_id: data.dealId,
      crm_sync_status: data.status,
      crm_sync_error: null,
      crm_signed_roa_document_id: data.signedRoaDocumentId || null,
      crm_certificate_document_id: data.certificateDocumentId || null,
      crm_audit_log_document_id: data.auditLogDocumentId || null,
    };
    if (data.status === 'linked') patch.crm_synced_at = new Date().toISOString();
    return updateSubmission(row.id, patch);
  } catch (error) {
    const code = error instanceof CrmSyncError ? error.code : 'crm_sync_failed';
    current = await updateSubmission(row.id, {
      crm_sync_status: 'failed',
      crm_sync_error: code,
    });
    const safe = error instanceof CrmSyncError ? error : new CrmSyncError(code);
    safe.row = current;
    throw safe;
  }
}

export async function maybeSyncCompletedSubmissionToCrm(row) {
  if (row?.status !== 'completed' || !hasRequiredSigningEvidence(row)) return row;
  if (isCrmEvidenceComplete(row)) return row;
  try { return await syncSubmissionToCrm(row); }
  catch (error) {
    console.warn('CRM sync after evidence reconciliation failed:', error?.code || 'crm_sync_failed');
    return error?.row || row;
  }
}
