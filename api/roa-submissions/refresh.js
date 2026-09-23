// POST /api/roa-submissions/refresh
//
// Polls the Documenso envelope and, on completion, retains the final signed
// PDF, signing certificate and audit-log PDF as ROA evidence.
//
// Contract:
//   • Broker-scoped.
//   • Provider status is persisted as observed.
//   • completed_at means COMPLETED only.
//   • Each artefact is hashed and stored at a deterministic private path.
//   • Partial evidence retrieval is safe to retry.
//   • evidence_retrieved_at is set only when signed + certificate + audit exist.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import {
  downloadAuditLogPdf,
  downloadCertificatePdf,
  downloadSignedPdf,
  getEnvelope,
  isDocumensoConfigured,
  mapDocumensoEnvelopeState,
} from '../_lib/documensoClient.js';
import {
  ensurePdfStored,
  loadSubmissionForBroker,
  StoragePaths,
  updateSubmission,
} from '../_lib/submissionRepo.js';
import { sha256HexOfBytes } from '../_lib/sha256.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { toClientView } from './get.js';

function completedTimestamp(envelope) {
  const providerValue = envelope?.completedAt;
  if (providerValue) {
    const date = new Date(providerValue);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const { submissionId } = req.body ?? {};
  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'Invalid submissionId' });

  const row = await loadSubmissionForBroker(submissionId, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (!row.signature_envelope_id) {
    return res.status(200).json({
      ok: true,
      submission: toClientView(row),
      refreshed: false,
    });
  }

  if (
    row.status === 'completed'
    && row.signed_pdf_storage_path
    && row.certificate_storage_path
    && row.audit_log_storage_path
  ) {
    return res.status(200).json({
      ok: true,
      submission: toClientView(row),
      refreshed: false,
    });
  }

  if (!isDocumensoConfigured()) {
    return res.status(200).json({
      ok: true,
      submission: toClientView(row),
      refreshed: false,
      message: 'Dev mock — no Documenso refresh performed',
    });
  }

  let envelope;
  try {
    envelope = await getEnvelope(row.signature_envelope_id);
  } catch (err) {
    console.error('refresh: Documenso envelope fetch failed', err?.message);
    return res.status(503).json({
      error: 'signature_provider_status_failed',
      provider: 'documenso',
    });
  }

  const { providerStatus, lifecycleStatus } = mapDocumensoEnvelopeState(envelope);
  const patch = {
    signature_provider: 'documenso',
    signature_envelope_id: envelope.id,
  };

  if (providerStatus) patch.signature_status = providerStatus;
  if (lifecycleStatus && lifecycleStatus !== row.status) patch.status = lifecycleStatus;

  if (providerStatus === 'completed' && !row.completed_at) {
    patch.completed_at = completedTimestamp(envelope);
  }

  let signedRetrieved = Boolean(row.signed_pdf_storage_path);
  let certificateRetrieved = Boolean(row.certificate_storage_path);
  let auditRetrieved = Boolean(row.audit_log_storage_path);
  const evidenceErrors = [];

  if (providerStatus === 'completed') {
    if (!signedRetrieved) {
      try {
        const signedBytes = await downloadSignedPdf(envelope);
        const signedHash = sha256HexOfBytes(signedBytes);
        const signedPath = StoragePaths.signed(submissionId);
        await ensurePdfStored(signedPath, signedBytes, { expectedSha256: signedHash });
        patch.signed_pdf_storage_path = signedPath;
        patch.signed_pdf_sha256 = signedHash;
        signedRetrieved = true;
      } catch (err) {
        console.error('refresh: signed PDF retrieval failed', err?.message);
        evidenceErrors.push('signed');
      }
    }

    if (!certificateRetrieved) {
      try {
        const certificateBytes = await downloadCertificatePdf(envelope.id);
        const certificateHash = sha256HexOfBytes(certificateBytes);
        const certificatePath = StoragePaths.certificate(submissionId);
        await ensurePdfStored(certificatePath, certificateBytes, { expectedSha256: certificateHash });
        patch.certificate_storage_path = certificatePath;
        patch.certificate_sha256 = certificateHash;
        certificateRetrieved = true;
      } catch (err) {
        console.error('refresh: certificate retrieval failed', err?.message);
        evidenceErrors.push('certificate');
      }
    }

    if (!auditRetrieved) {
      try {
        const auditBytes = await downloadAuditLogPdf(envelope.id);
        const auditHash = sha256HexOfBytes(auditBytes);
        const auditPath = StoragePaths.audit(submissionId);
        await ensurePdfStored(auditPath, auditBytes, { expectedSha256: auditHash });
        patch.audit_log_storage_path = auditPath;
        patch.audit_log_sha256 = auditHash;
        auditRetrieved = true;
      } catch (err) {
        console.error('refresh: audit log retrieval failed', err?.message);
        evidenceErrors.push('audit');
      }
    }

    if (
      signedRetrieved
      && certificateRetrieved
      && auditRetrieved
      && !row.evidence_retrieved_at
    ) {
      patch.evidence_retrieved_at = new Date().toISOString();
    }
  }

  let updated;
  try {
    updated = Object.keys(patch).length > 0
      ? await updateSubmission(submissionId, patch)
      : row;
  } catch (err) {
    console.error('refresh: evidence metadata persistence failed', err?.message);
    return res.status(500).json({
      error: 'evidence_metadata_persist_failed',
      provider: 'documenso',
      evidenceErrors: evidenceErrors.length ? evidenceErrors : undefined,
    });
  }

  return res.status(200).json({
    ok: true,
    provider: 'documenso',
    submission: toClientView(updated),
    refreshed: true,
    observedStatus: providerStatus,
    evidenceErrors: evidenceErrors.length ? evidenceErrors : undefined,
  });
}
