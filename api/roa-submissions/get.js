// GET /api/roa-submissions/get?id=ROA-<uuid> — read submission metadata.
//
// Broker-scoped: 401 unauthenticated; 404 on either "does not exist" or "not
// yours" (safe convention — the caller cannot distinguish, so cross-broker
// existence is not leaked). Never returns snapshot_json to the browser —
// that data lives durably server-side; the UI works from the returned
// metadata only.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { loadSubmissionForBroker } from '../_lib/submissionRepo.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';

export function toClientView(row) {
  if (!row) return null;
  return {
    submissionId: row.id,
    roaType: row.roa_type,
    status: row.status,
    clientReference: row.client_reference,
    advisorEmail: row.advisor_email,
    templateVersion: row.template_version,
    statutoryDisclosureVersion: row.statutory_disclosure_version,
    brokerAppointmentVersion: row.broker_appointment_version,
    brokerFeeVersion: row.broker_fee_version,
    letterInvestigationVersion: row.letter_investigation_version,
    pdfSha256: row.pdf_sha256,
    pdfByteLength: row.pdf_byte_length,
    signatureProvider: row.signature_provider,
    signatureEnvelopeId: row.signature_envelope_id,
    signatureStatus: row.signature_status,
    hasCanonicalPdf: Boolean(row.pdf_storage_path),
    hasSignedPdf: Boolean(row.signed_pdf_storage_path),
    hasCertificate: Boolean(row.certificate_storage_path),
    hasAuditLog: Boolean(row.audit_log_storage_path),
    crmClientId: row.crm_client_id,
    crmDealId: row.crm_deal_id,
    submittedAt: row.submitted_at,
    sentForSignatureAt: row.sent_for_signature_at,
    completedAt: row.completed_at,
    evidenceRetrievedAt: row.evidence_retrieved_at,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const id = String(req.query?.id ?? '');
  if (!isSubmissionId(id)) return res.status(400).json({ error: 'Invalid submissionId' });

  const row = await loadSubmissionForBroker(id, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  return res.status(200).json({ ok: true, submission: toClientView(row) });
}
