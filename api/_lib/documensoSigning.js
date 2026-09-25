import {
  addRoaSigningFields,
  createDocumensoEnvelope,
  distributeDocumensoEnvelope,
  downloadDocumensoAuditLog,
  downloadDocumensoCertificate,
  downloadDocumensoSignedPdf,
  findDocumensoEnvelopeByExternalId,
  getDocumensoEnvelope,
  getDocumensoEnvelopeStatus,
  isDocumensoConfigured,
} from './documensoClient.js';
import {
  downloadPdf,
  ensurePdfStored,
  releaseSigningReservation,
  reserveSigningSlot,
  setCompletionIfMissing,
  StoragePaths,
  updateSubmission,
} from './submissionRepo.js';
import { sha256HexOfBytes } from './sha256.js';
import { BROKER_EMAIL_MAP, EMAIL_TO_BROKER } from '../../src/lib/brokerDirectory.js';

const PROVIDER = 'documenso';
const SEND_IN_FLIGHT_GRACE_MS = 60 * 1000;

function reservationMayStillBeInFlight(sentForSignatureAt) {
  const sentAt = Date.parse(sentForSignatureAt || '');
  if (!Number.isFinite(sentAt)) return false;
  const age = Date.now() - sentAt;
  return age >= 0 && age < SEND_IN_FLIGHT_GRACE_MS;
}

function brokerIdentity(user) {
  const email = String(user?.email || '');
  const name =
    EMAIL_TO_BROKER[email]
    || EMAIL_TO_BROKER[email.toLowerCase()]
    || Object.entries(BROKER_EMAIL_MAP).find(([, candidate]) => candidate.toLowerCase() === email.toLowerCase())?.[0];

  if (!name) throw new Error('broker_lookup_failed');
  return { name, email: BROKER_EMAIL_MAP[name] };
}

function mapStatus(status) {
  switch (String(status || '').toUpperCase()) {
    case 'COMPLETED': return 'completed';
    case 'REJECTED': return 'declined';
    case 'CANCELLED': return 'voided';
    case 'PENDING': return 'awaiting_signature';
    case 'DRAFT': return 'awaiting_signature';
    default: return null;
  }
}

function hasExpectedFields(envelope) {
  const fields = Array.isArray(envelope?.fields) ? envelope.fields : [];
  const sigs = fields.filter((f) => f?.type === 'SIGNATURE');
  const dates = fields.filter((f) => f?.type === 'DATE');
  return sigs.length >= 2 && dates.length >= 2;
}

async function prepareExistingEnvelope({
  envelopeId,
  subject,
  message,
  brokerEmail,
}) {
  let envelope = await getDocumensoEnvelope(envelopeId);

  let itemId = envelope?.envelopeItems?.[0]?.id || null;
  if (!hasExpectedFields(envelope)) {
    const configured = await addRoaSigningFields({ envelopeId, envelope });
    itemId = configured.envelopeItemId;
    envelope = await getDocumensoEnvelope(envelopeId);
  }

  if (String(envelope?.status || '').toUpperCase() === 'DRAFT') {
    await distributeDocumensoEnvelope({ envelopeId, subject, message, brokerEmail });
    envelope = await getDocumensoEnvelope(envelopeId);
  }

  return { envelope, itemId: itemId || envelope?.envelopeItems?.[0]?.id || null };
}

export async function sendViaDocumenso({
  submissionId,
  row,
  user,
  signerName,
  signerEmail,
  subject,
  message,
}) {
  if (!isDocumensoConfigured()) {
    const err = new Error('documenso_environment_misconfigured');
    err.status = 500;
    throw err;
  }

  if (row.signing_provider === PROVIDER && row.signing_envelope_id) {
    return {
      alreadySent: true,
      envelopeId: row.signing_envelope_id,
      status: row.signing_status,
      row,
    };
  }

  const broker = brokerIdentity(user);

  if (row.status === 'awaiting_signature' && !row.signing_envelope_id) {
    if (reservationMayStillBeInFlight(row.sent_for_signature_at)) {
      const err = new Error('send_in_progress');
      err.status = 409;
      throw err;
    }

    const recovered = await findDocumensoEnvelopeByExternalId(submissionId);
    if (!recovered?.id) {
      await releaseSigningReservation(submissionId, user.id, PROVIDER, {
        reason: 'not_found_after_ambiguous_send',
      });
      const err = new Error('documenso_send_unconfirmed');
      err.status = 503;
      err.retryable = true;
      throw err;
    }

    const prepared = await prepareExistingEnvelope({
      envelopeId: recovered.id,
      subject,
      message,
      brokerEmail: broker.email,
    });
    const updated = await updateSubmission(submissionId, {
      signing_provider: PROVIDER,
      signing_envelope_id: recovered.id,
      signing_item_id: prepared.itemId,
      signing_status: String(prepared.envelope?.status || 'PENDING').toLowerCase(),
      signing_meta: { externalId: submissionId },
    });
    return {
      recovered: true,
      envelopeId: recovered.id,
      status: updated.signing_status,
      row: updated,
    };
  }

  const reservation = await reserveSigningSlot(submissionId, user.id, PROVIDER);
  if (!reservation.reserved) {
    const current = reservation.row;
    if (current?.signing_provider === PROVIDER && current?.signing_envelope_id) {
      return {
        alreadySent: true,
        envelopeId: current.signing_envelope_id,
        status: current.signing_status,
        row: current,
      };
    }
    const err = new Error('send_in_progress');
    err.status = 409;
    throw err;
  }

  const reserved = reservation.row;
  const pdfBytes = await downloadPdf(reserved.pdf_storage_path);
  const actualHash = sha256HexOfBytes(pdfBytes);
  if (actualHash !== reserved.pdf_sha256) {
    await releaseSigningReservation(submissionId, user.id, PROVIDER, {
      reason: 'canonical_hash_mismatch',
    });
    const err = new Error('canonical_hash_mismatch');
    err.status = 500;
    throw err;
  }

  let envelopeId;
  try {
    envelopeId = await createDocumensoEnvelope({
      submissionId,
      pdfBytes,
      filename: `${submissionId}-canonical.pdf`,
      signerName,
      signerEmail,
      brokerName: broker.name,
      brokerEmail: broker.email,
      subject,
      message,
    });
  } catch (createErr) {
    // A provider 4xx response is a definite rejection. A 5xx or network/runtime
    // failure is ambiguous and must never unlock a potentially-created send.
    if (Number.isFinite(createErr?.status) && createErr.status < 500) {
      await releaseSigningReservation(submissionId, user.id, PROVIDER, {
        reason: `create_http_${createErr.status}`,
      });
      throw createErr;
    }

    let recovered = null;
    try {
      recovered = await findDocumensoEnvelopeByExternalId(submissionId);
    } catch {
      // Keep the reservation locked: create outcome is ambiguous.
      const err = new Error('documenso_send_ambiguous');
      err.status = 503;
      err.retryable = false;
      throw err;
    }

    if (!recovered?.id) {
      const err = new Error('documenso_send_ambiguous');
      err.status = 503;
      err.retryable = false;
      throw err;
    }
    envelopeId = recovered.id;
  }

  const prepared = await prepareExistingEnvelope({
    envelopeId,
    subject,
    message,
    brokerEmail: broker.email,
  });

  const updated = await updateSubmission(submissionId, {
    signing_provider: PROVIDER,
    signing_envelope_id: envelopeId,
    signing_item_id: prepared.itemId,
    signing_status: String(prepared.envelope?.status || 'PENDING').toLowerCase(),
    signing_meta: { externalId: submissionId },
  });

  return {
    envelopeId,
    status: updated.signing_status,
    row: updated,
  };
}

export async function refreshViaDocumenso({ submissionId, row, brokerUserId }) {
  if (!row.signing_envelope_id) {
    return { refreshed: false, row };
  }

  const observed = await getDocumensoEnvelopeStatus(row.signing_envelope_id);
  const patch = {
    signing_status: observed.status.toLowerCase(),
  };

  const lifecycleStatus = mapStatus(observed.status);
  if (lifecycleStatus && lifecycleStatus !== row.status) patch.status = lifecycleStatus;

  if (observed.status === 'COMPLETED' && !row.completed_at) {
    await setCompletionIfMissing(
      submissionId,
      brokerUserId,
      observed.completedAt || new Date().toISOString(),
    );
  }

  const itemId = row.signing_item_id || observed.envelopeItemId;
  if (itemId && !row.signing_item_id) patch.signing_item_id = itemId;

  let signedRetrieved = Boolean(row.signed_pdf_storage_path);
  let certificateRetrieved = Boolean(row.certificate_storage_path);
  let auditRetrieved = Boolean(row.audit_log_storage_path);
  const evidenceErrors = [];

  if (observed.status === 'COMPLETED') {
    if (!signedRetrieved && itemId) {
      try {
        const bytes = await downloadDocumensoSignedPdf(itemId);
        const path = StoragePaths.signed(submissionId);
        const hash = sha256HexOfBytes(bytes);
        await ensurePdfStored(path, bytes, { expectedSha256: hash });
        patch.signed_pdf_storage_path = path;
        patch.signed_pdf_sha256 = hash;
        signedRetrieved = true;
      } catch {
        evidenceErrors.push('signed');
      }
    }

    if (!certificateRetrieved) {
      try {
        const bytes = await downloadDocumensoCertificate(row.signing_envelope_id);
        const path = StoragePaths.certificate(submissionId);
        const hash = sha256HexOfBytes(bytes);
        await ensurePdfStored(path, bytes, { expectedSha256: hash });
        patch.certificate_storage_path = path;
        patch.certificate_sha256 = hash;
        certificateRetrieved = true;
      } catch {
        evidenceErrors.push('certificate');
      }
    }

    if (!auditRetrieved) {
      try {
        const bytes = await downloadDocumensoAuditLog(row.signing_envelope_id);
        const path = StoragePaths.auditLog(submissionId);
        const hash = sha256HexOfBytes(bytes);
        await ensurePdfStored(path, bytes, { expectedSha256: hash });
        patch.audit_log_storage_path = path;
        patch.audit_log_sha256 = hash;
        auditRetrieved = true;
      } catch {
        evidenceErrors.push('audit');
      }
    }

    if (signedRetrieved && certificateRetrieved && auditRetrieved && !row.evidence_retrieved_at) {
      patch.evidence_retrieved_at = new Date().toISOString();
    }
  }

  const updated = await updateSubmission(submissionId, patch);
  return {
    refreshed: true,
    observedStatus: observed.status,
    evidenceErrors,
    row: updated,
  };
}
