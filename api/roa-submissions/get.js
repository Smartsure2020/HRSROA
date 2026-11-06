// GET /api/roa-submissions/get?id=ROA-<uuid> — read submission metadata.
//
// Broker-scoped: 401 unauthenticated; 404 on either "does not exist" or "not
// yours" (safe convention — the caller cannot distinguish, so cross-broker
// existence is not leaked). Never returns snapshot_json to the browser —
// that data lives durably server-side; the UI works from the returned
// metadata only.
//
// GET /api/roa-submissions/get?id=ROA-<uuid>&view=amendment — the ONE exception: the
// owner's frozen source snapshot, so the existing Personal / Commercial wizard can open
// pre-populated for an amendment (never rebuilt from a PDF). It lives on this route
// because the project is at the Vercel Hobby 12-function ceiling. It is owner-scoped like
// everything else, only answers for an amendable head revision, is sent `no-store`, is
// never logged, and is never part of the normal get / list responses.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { loadSubmissionForBroker, SUPERSEDABLE_STATUSES } from '../_lib/submissionRepo.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { derivedComplianceAvailability } from '../_lib/derivedCompliancePdf.js';
import { hasSigningEnvelope, signingProviderFor } from '../_lib/signingLifecycle.js';
import { amendmentBlockReason, amendmentWillCancelSigningRequest } from '../../src/lib/roaAmendment.js';

function amendmentFacts(row) {
  return {
    status: row.status,
    supersededBySubmissionId: row.superseded_by_submission_id || null,
    hasEnvelope: hasSigningEnvelope(row),
    signingProvider: signingProviderFor(row),
  };
}

function manualResolutionReason(row) {
  const flag = row.signing_meta?.supersession?.manualResolution;
  if (!flag?.required || flag.resolvedAt) return null;
  // Only meaningful while the request is still open; once voided/completed it is history.
  if (!SUPERSEDABLE_STATUSES.includes(row.status) || row.completed_at) return null;
  return String(flag.reason || 'manual_resolution_required');
}

export function toClientView(row) {
  if (!row) return null;
  const compliance = derivedComplianceAvailability(row);
  const amendBlockReason = amendmentBlockReason(amendmentFacts(row));
  return {
    submissionId: row.id,
    roaType: row.roa_type,
    status: row.status,
    clientReference: row.client_reference,
    adviser: row.advisor_email,
    advisorEmail: row.advisor_email,
    templateVersion: row.template_version,
    statutoryDisclosureVersion: row.statutory_disclosure_version,
    brokerAppointmentVersion: row.broker_appointment_version,
    brokerFeeVersion: row.broker_fee_version,
    letterInvestigationVersion: row.letter_investigation_version,
    pdfSha256: row.pdf_sha256,
    pdfByteLength: row.pdf_byte_length,
    signingProvider: row.signing_provider || (row.docusign_envelope_id ? 'docusign' : null),
    signingEnvelopeId: row.signing_envelope_id || row.docusign_envelope_id || null,
    signingStatus: row.signing_status || row.docusign_status || null,
    docusignEnvelopeId: row.docusign_envelope_id,
    docusignStatus: row.docusign_status,
    hasCanonicalPdf: Boolean(row.pdf_storage_path),
    hasSignedPdf: Boolean(row.signed_pdf_storage_path),
    hasCertificate: Boolean(row.certificate_storage_path),
    hasAuditLog: Boolean(row.audit_log_storage_path),
    hasBrokerAppointmentDownload: compliance.brokerAppointment,
    hasLetterInvestigationDownload: compliance.letterInvestigation,
    crmClientId: row.crm_client_id,
    crmDealId: row.crm_deal_id,
    crmSyncStatus: row.crm_sync_status || (row.crm_client_id && row.crm_deal_id ? 'partial' : null),
    crmSyncError: row.crm_sync_error,
    crmSyncAttemptedAt: row.crm_sync_attempted_at,
    crmSyncedAt: row.crm_synced_at,
    crmSignedRoaDocumentId: row.crm_signed_roa_document_id,
    crmCertificateDocumentId: row.crm_certificate_document_id,
    crmAuditLogDocumentId: row.crm_audit_log_document_id || null,
    lastReminderAt: row.signing_meta?.lastReminderAt || null,
    reminderCount: Number(row.signing_meta?.reminderCount || 0),
    submittedAt: row.submitted_at,
    sentForSignatureAt: row.sent_for_signature_at,
    completedAt: row.completed_at,
    evidenceRetrievedAt: row.evidence_retrieved_at,
    // Revision lineage (Issue #8). A revision's own signing/evidence fields above are never
    // altered by a later revision; lineage is reported separately here.
    revisionNo: Number(row.revision_no) || 1,
    parentSubmissionId: row.parent_submission_id || null,
    supersedesSubmissionId: row.supersedes_submission_id || null,
    supersededBySubmissionId: row.superseded_by_submission_id || null,
    isCurrentRevision: !row.superseded_by_submission_id,
    amendmentReason: row.amendment_reason || null,
    amendmentReasonDetail: row.amendment_reason_detail || null,
    amendedBy: row.amended_by || null,
    amendedAt: row.amended_at || null,
    amendable: amendBlockReason === null,
    amendBlockReason,
    // Set while a replacement could not be sent because this still-open request cannot be
    // cancelled safely by automation; a person must resolve it (see the operator runbook).
    supersessionManualResolution: manualResolutionReason(row),
    amendWillCancelSigningRequest: amendmentWillCancelSigningRequest({
      status: row.status,
      hasEnvelope: hasSigningEnvelope(row),
    }),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const id = String(req.query?.id ?? '');
  if (!isSubmissionId(id)) return res.status(400).json({ error: 'Invalid submissionId' });

  const row = await loadSubmissionForBroker(id, user);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (req.query?.view === 'amendment') {
    res.setHeader('Vary', 'Authorization');
    const blockReason = amendmentBlockReason(amendmentFacts(row));
    if (blockReason) {
      return res.status(409).json({ error: blockReason, submission: toClientView(row) });
    }
    const snapshot = row.snapshot_json;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return res.status(409).json({ error: 'snapshot_unavailable' });
    }
    return res.status(200).json({
      ok: true,
      amendment: {
        submissionId: row.id,
        roaType: row.roa_type,
        status: row.status,
        revisionNo: Number(row.revision_no) || 1,
        nextRevisionNo: (Number(row.revision_no) || 1) + 1,
        clientReference: row.client_reference,
        willCancelSigningRequest: amendmentWillCancelSigningRequest({
          status: row.status,
          hasEnvelope: hasSigningEnvelope(row),
        }),
        snapshot,
      },
    });
  }

  return res.status(200).json({ ok: true, submission: toClientView(row) });
}
