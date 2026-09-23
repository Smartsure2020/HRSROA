// POST /api/roa-submissions/send-for-signature
//
// Creates or resumes the Documenso signing envelope for the submission's
// canonical PDF. ROA remains the evidence authority; Documenso is the signing
// provider only.
//
// Reliability contract:
//   • ROA submissionId is Documenso externalId.
//   • The DB reservation blocks concurrent duplicate sends.
//   • Lost provider responses reconcile by externalId before any new create.
//   • Once an envelope id is known, retries resume field/distribution setup.
//   • Canonical bytes are loaded from private Storage and hash-verified before
//     the first provider upload.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import {
  DocumensoApiError,
  ensureEnvelopeCreated,
  ensureEnvelopeDistributed,
  ensureRoaFields,
  findEnvelopeByExternalId,
  getEnvelope,
  isDocumensoConfigured,
  mapDocumensoEnvelopeState,
} from '../_lib/documensoClient.js';
import {
  downloadPdf,
  loadSubmissionForBroker,
  releaseEnvelopeReservation,
  reserveEnvelopeSlot,
  updateSubmission,
} from '../_lib/submissionRepo.js';
import { sha256HexOfBytes } from '../_lib/sha256.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import {
  BROKER_EMAIL_MAP,
  EMAIL_TO_BROKER,
} from '../../src/lib/brokerDirectory.js';
import { toClientView } from './get.js';

const AMBIGUOUS_SEND_GRACE_MS = 2 * 60 * 1000;

function brokerForAuthenticatedUser(user) {
  const authenticatedBrokerEmail = user.email;
  const brokerName = EMAIL_TO_BROKER[authenticatedBrokerEmail]
    || EMAIL_TO_BROKER[authenticatedBrokerEmail?.toLowerCase?.() ?? '']
    || Object.entries(BROKER_EMAIL_MAP).find(
      ([, email]) => email.toLowerCase() === String(authenticatedBrokerEmail).toLowerCase(),
    )?.[0];

  if (!brokerName) return null;
  return { brokerName, brokerEmail: BROKER_EMAIL_MAP[brokerName] };
}

function reservationAgeMs(row) {
  const sentAt = Date.parse(row?.sent_for_signature_at || '');
  if (!Number.isFinite(sentAt)) return 0;
  return Math.max(0, Date.now() - sentAt);
}

async function persistProviderEnvelope(submissionId, envelope) {
  const { providerStatus, lifecycleStatus } = mapDocumensoEnvelopeState(envelope);
  const patch = {
    signature_provider: 'documenso',
    signature_envelope_id: envelope.id,
    signature_status: providerStatus,
  };
  if (lifecycleStatus) patch.status = lifecycleStatus;
  return updateSubmission(submissionId, patch);
}

function providerErrorResponse(res, err, { ambiguous = false } = {}) {
  console.error('send-for-signature: Documenso error', err?.message);

  if (ambiguous || !(err instanceof DocumensoApiError)) {
    return res.status(503).json({
      error: 'signature_provider_ambiguous',
      provider: 'documenso',
      retryable: false,
      message: 'The signing request could not be confirmed safely. The ROA remains locked for reconciliation.',
    });
  }

  const status = err.status >= 400 && err.status < 500 ? err.status : 503;
  return res.status(status).json({
    error: 'signature_provider_failed',
    provider: 'documenso',
    retryable: status >= 500,
    message: err.message,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const { submissionId, signerName, signerEmail, subject, message } = req.body ?? {};

  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'Invalid submissionId' });
  if (typeof signerName !== 'string' || !signerName.trim()) {
    return res.status(400).json({ error: 'Missing signerName' });
  }
  if (typeof signerEmail !== 'string' || !signerEmail.includes('@')) {
    return res.status(400).json({ error: 'Missing signerEmail' });
  }

  let row = await loadSubmissionForBroker(submissionId, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const broker = brokerForAuthenticatedUser(user);
  if (!broker) return res.status(500).json({ error: 'broker_lookup_failed' });

  // Development path: preserves the endpoint/UI contract without any external
  // signing call. Production/staging acceptance requires real Documenso env.
  if (!isDocumensoConfigured()) {
    if (row.signature_envelope_id) {
      return res.status(200).json({
        ok: true,
        alreadySent: true,
        provider: 'documenso',
        envelopeId: row.signature_envelope_id,
        status: row.signature_status,
        submission: toClientView(row),
        message: 'Dev mock — no Documenso request sent',
      });
    }

    const reservation = await reserveEnvelopeSlot(submissionId, user.id);
    if (!reservation.reserved) {
      return res.status(409).json({
        ok: false,
        error: 'send_in_progress',
        submission: toClientView(reservation.row),
      });
    }

    const mockEnvelopeId = `dev-documenso-${submissionId.slice(4, 12)}`;
    const updated = await updateSubmission(submissionId, {
      signature_provider: 'documenso',
      signature_envelope_id: mockEnvelopeId,
      signature_status: 'pending',
      status: 'awaiting_signature',
    });

    return res.status(200).json({
      ok: true,
      provider: 'documenso',
      envelopeId: mockEnvelopeId,
      status: 'pending',
      submission: toClientView(updated),
      message: 'Dev mock — no Documenso request sent',
    });
  }

  let envelope = null;
  let ownsFreshReservation = false;

  // If a provider id is already persisted, this is a resumable retry. Never
  // create again: load the exact envelope and continue any missing setup.
  if (row.signature_envelope_id) {
    try {
      envelope = await getEnvelope(row.signature_envelope_id);
    } catch (err) {
      return providerErrorResponse(res, err, { ambiguous: true });
    }
  } else if (row.status === 'awaiting_signature') {
    // A previous request reserved the row but may have lost the provider
    // response before persisting the envelope id. Reconcile by externalId.
    let recovered;
    try {
      recovered = await findEnvelopeByExternalId(submissionId);
    } catch (err) {
      return providerErrorResponse(res, err, { ambiguous: true });
    }

    if (recovered?.id) {
      try {
        envelope = await getEnvelope(recovered.id);
        row = await persistProviderEnvelope(submissionId, envelope);
      } catch (err) {
        return providerErrorResponse(res, err, { ambiguous: true });
      }
    } else if (reservationAgeMs(row) < AMBIGUOUS_SEND_GRACE_MS) {
      return res.status(409).json({
        ok: false,
        error: 'send_in_progress',
        provider: 'documenso',
        retryable: true,
        submission: toClientView(row),
      });
    } else {
      await releaseEnvelopeReservation(submissionId, user.id, {
        reason: 'documenso_external_id_not_found',
      });
      const released = await loadSubmissionForBroker(submissionId, user.id);
      return res.status(503).json({
        error: 'signature_send_unconfirmed',
        provider: 'documenso',
        retryable: true,
        message: 'No Documenso envelope exists for this ROA. The reservation was released and a retry is safe.',
        submission: toClientView(released),
      });
    }
  } else {
    const reservation = await reserveEnvelopeSlot(submissionId, user.id);
    if (!reservation.reserved) {
      const current = reservation.row;
      if (current?.signature_envelope_id) {
        try {
          envelope = await getEnvelope(current.signature_envelope_id);
          row = current;
        } catch (err) {
          return providerErrorResponse(res, err, { ambiguous: true });
        }
      } else {
        return res.status(409).json({
          ok: false,
          error: 'send_in_progress',
          submission: toClientView(current),
        });
      }
    } else {
      row = reservation.row;
      ownsFreshReservation = true;
    }
  }

  if (!envelope) {
    // Only the request that acquired the fresh reservation is allowed to upload
    // and create. Verify the canonical bytes immediately before provider upload.
    let pdfBytes;
    try {
      pdfBytes = await downloadPdf(row.pdf_storage_path);
    } catch (err) {
      if (ownsFreshReservation) {
        await releaseEnvelopeReservation(submissionId, user.id, { reason: 'canonical_download_failed' });
      }
      console.error('send-for-signature: canonical download failed', err?.message);
      return res.status(500).json({ error: 'canonical_download_failed' });
    }

    const actualHash = sha256HexOfBytes(pdfBytes);
    if (actualHash !== row.pdf_sha256) {
      if (ownsFreshReservation) {
        await releaseEnvelopeReservation(submissionId, user.id, { reason: 'canonical_hash_mismatch' });
      }
      return res.status(500).json({ error: 'canonical_hash_mismatch' });
    }

    try {
      envelope = await ensureEnvelopeCreated({
        submissionId,
        roaType: row.roa_type,
        signerName: signerName.trim(),
        signerEmail: signerEmail.trim(),
        brokerName: broker.brokerName,
        brokerEmail: broker.brokerEmail,
        pdfBytes,
        subject,
        message,
      });
      row = await persistProviderEnvelope(submissionId, envelope);
    } catch (err) {
      // A 4xx returned after externalId reconciliation is a definite provider
      // rejection and can be released. Network/5xx stays locked.
      const definiteFailure =
        err instanceof DocumensoApiError
        && err.status >= 400
        && err.status < 500
        && !err.reconciliationError;

      if (ownsFreshReservation && definiteFailure) {
        await releaseEnvelopeReservation(submissionId, user.id, {
          reason: `documenso_http_${err.status}`,
        });
      }

      return providerErrorResponse(res, err, { ambiguous: !definiteFailure });
    }
  }

  // From this point an envelope id is durable in ROA. Every failure is
  // resumable against that exact provider envelope and must never release the
  // reservation into a create-again state.
  try {
    envelope = await ensureRoaFields(envelope, {
      signerEmail: signerEmail.trim(),
      brokerEmail: broker.brokerEmail,
    });

    envelope = await ensureEnvelopeDistributed(envelope, { subject, message });
  } catch (err) {
    console.error('send-for-signature: Documenso setup/distribution failed', err?.message);

    const currentEnvelope = envelope?.id ? envelope : null;
    if (currentEnvelope) {
      const { providerStatus } = mapDocumensoEnvelopeState(currentEnvelope);
      if (providerStatus) {
        await updateSubmission(submissionId, {
          signature_provider: 'documenso',
          signature_envelope_id: currentEnvelope.id,
          signature_status: providerStatus,
        }).catch(() => {});
      }
    }

    return providerErrorResponse(res, err, { ambiguous: !(err instanceof DocumensoApiError) });
  }

  const updated = await persistProviderEnvelope(submissionId, envelope);
  const { providerStatus } = mapDocumensoEnvelopeState(envelope);

  return res.status(200).json({
    ok: true,
    provider: 'documenso',
    envelopeId: envelope.id,
    status: providerStatus,
    alreadySent: Boolean(row.signature_envelope_id),
    submission: toClientView(updated),
    message: `Signature request sent to ${signerEmail}. ${broker.brokerName} will countersign after the client.`,
  });
}
