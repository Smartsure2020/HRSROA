// POST /api/roa-submissions/send-for-signature — create the DocuSign envelope
// for a submission's canonical PDF (Phase ROA-1 / ROA-1.1 reliability).
//
// Idempotency contract:
//   • One submission maps to one stable DocuSign transactionId (the submission id).
//   • Once an envelope id is stored, every later Send returns it.
//   • A definite provider rejection releases the reservation and is retryable.
//   • A network-ambiguous create is reconciled by transactionId before any retry.
//   • If reconciliation itself is unavailable, the reservation stays locked.
//   • transactionId lookups are only authoritative for DocuSign's documented
//     seven-day window; after that, "not found" does NOT permit blind resend.
//
// Canonical PDF contract:
//   • The PDF sent to DocuSign comes from Storage, not from the request.
//   • Its SHA-256 is verified against roa_submissions.pdf_sha256 before send.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import {
  getConfiguredBaseUrlOverride,
  getDocusignConfig,
} from '../_lib/docusignConfig.js';
import { resolveDocusignAccountBaseUrl } from '../_lib/docusignAccount.js';
import { getDocusignAccessToken } from '../_lib/docusignJwt.js';
import { buildEnvelope } from '../_lib/buildEnvelope.js';
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
import { sendViaDocumenso } from '../_lib/documensoSigning.js';

const DOCUSIGN_TRANSACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function transactionIdForSubmission(submissionId) {
  return submissionId;
}

function transactionLookupStillAuthoritative(sentForSignatureAt) {
  const sentAt = Date.parse(sentForSignatureAt || '');
  if (!Number.isFinite(sentAt)) return false;
  const age = Date.now() - sentAt;
  return age >= 0 && age < DOCUSIGN_TRANSACTION_TTL_MS;
}

async function resolveDocusignRuntime() {
  const config = getDocusignConfig();
  const accessToken = await getDocusignAccessToken(config.authServer);
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  if (!accountId) throw new Error('DOCUSIGN_ACCOUNT_ID is not configured');

  const override = getConfiguredBaseUrlOverride();
  const accountBaseUrl = override
    ? override.replace(/\/+$/, '')
    : (await resolveDocusignAccountBaseUrl({
        authServer: config.authServer,
        accessToken,
        accountId,
      })).baseUrl;

  return { config, accessToken, accountId, accountBaseUrl };
}

async function findEnvelopeByTransactionId(runtime, transactionId) {
  const url =
    `${runtime.accountBaseUrl}/v2.1/accounts/${runtime.accountId}/envelopes`
    + `?transaction_ids=${encodeURIComponent(transactionId)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${runtime.accessToken}`,
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.message || data?.errorCode || `DocuSign reconciliation failed (${response.status})`);
    err.status = response.status;
    throw err;
  }

  const envelopes = Array.isArray(data?.envelopes) ? data.envelopes : [];
  const match = envelopes.find((e) => e?.transactionId === transactionId)
    || (envelopes.length === 1 ? envelopes[0] : null);

  if (!match?.envelopeId) return null;
  return {
    envelopeId: match.envelopeId,
    status: String(match.status || 'sent').toLowerCase(),
  };
}

async function reconcileAmbiguousSend({
  submissionId,
  user,
  row,
  runtime,
  res,
}) {
  const transactionId = transactionIdForSubmission(submissionId);

  let recovered;
  try {
    recovered = await findEnvelopeByTransactionId(runtime, transactionId);
  } catch (err) {
    console.error('send-for-signature: ambiguous send reconciliation failed', err?.message);
    return res.status(503).json({
      error: 'docusign_send_ambiguous',
      message: 'Envelope creation could not be confirmed. The submission remains locked until DocuSign can be reconciled safely.',
      retryable: false,
    });
  }

  if (recovered) {
    const updated = await updateSubmission(submissionId, {
      docusign_envelope_id: recovered.envelopeId,
      docusign_status: recovered.status,
    });
    return res.status(200).json({
      ok: true,
      recovered: true,
      envelopeId: recovered.envelopeId,
      status: recovered.status,
      environment: runtime.config.environment,
      submission: toClientView(updated),
    });
  }

  if (!transactionLookupStillAuthoritative(row.sent_for_signature_at)) {
    return res.status(409).json({
      error: 'docusign_manual_reconciliation_required',
      message: 'The transaction lookup window has expired. Do not resend until the envelope is checked manually in DocuSign.',
      retryable: false,
    });
  }

  await releaseEnvelopeReservation(submissionId, user.id, {
    reason: 'not_found_after_ambiguous_send',
  });
  return res.status(503).json({
    error: 'docusign_send_unconfirmed',
    message: 'DocuSign confirmed no envelope for this transaction id. The reservation was released and a retry is safe.',
    retryable: true,
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

  const row = await loadSubmissionForBroker(submissionId, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (String(process.env.ROA_SIGNING_PROVIDER || '').toLowerCase() === 'documenso') {
    try {
      const result = await sendViaDocumenso({
        submissionId,
        row,
        user,
        signerName,
        signerEmail,
        subject,
        message,
      });
      return res.status(200).json({
        ok: true,
        provider: 'documenso',
        alreadySent: result.alreadySent || undefined,
        recovered: result.recovered || undefined,
        envelopeId: result.envelopeId,
        status: result.status,
        submission: toClientView(result.row),
      });
    } catch (err) {
      console.error('send-for-signature: Documenso error', err?.message);
      return res.status(err?.status || 500).json({
        error: err?.message || 'documenso_send_failed',
        retryable: err?.retryable,
      });
    }
  }

  if (row.docusign_envelope_id) {
    return res.status(200).json({
      ok: true,
      alreadySent: true,
      envelopeId: row.docusign_envelope_id,
      status: row.docusign_status,
      submission: toClientView(row),
    });
  }

  if (row.status === 'awaiting_signature') {
    if (!process.env.DOCUSIGN_INTEGRATION_KEY) {
      return res.status(409).json({
        error: 'send_in_progress',
        submission: toClientView(row),
      });
    }

    let runtime;
    try {
      runtime = await resolveDocusignRuntime();
    } catch (err) {
      console.error('send-for-signature: reconciliation bootstrap failed', err?.message);
      return res.status(503).json({ error: 'docusign_reconciliation_unavailable' });
    }
    return reconcileAmbiguousSend({ submissionId, user, row, runtime, res });
  }

  const reservation = await reserveEnvelopeSlot(submissionId, user.id);
  if (!reservation.reserved) {
    const current = reservation.row;
    if (current?.docusign_envelope_id) {
      return res.status(200).json({
        ok: true,
        alreadySent: true,
        envelopeId: current.docusign_envelope_id,
        status: current.docusign_status,
        submission: toClientView(current),
      });
    }
    return res.status(409).json({
      ok: false,
      error: 'send_in_progress',
      submission: toClientView(current),
    });
  }

  const reservedRow = reservation.row;

  const authenticatedBrokerEmail = user.email;
  const brokerName = EMAIL_TO_BROKER[authenticatedBrokerEmail]
    || EMAIL_TO_BROKER[authenticatedBrokerEmail?.toLowerCase?.() ?? '']
    || Object.entries(BROKER_EMAIL_MAP).find(
      ([, email]) => email.toLowerCase() === String(authenticatedBrokerEmail).toLowerCase(),
    )?.[0];
  if (!brokerName) {
    await releaseEnvelopeReservation(submissionId, user.id, { reason: 'broker_lookup_failed' });
    return res.status(500).json({ error: 'broker_lookup_failed' });
  }
  const brokerEmail = BROKER_EMAIL_MAP[brokerName];

  let pdfBytes;
  try {
    pdfBytes = await downloadPdf(reservedRow.pdf_storage_path);
  } catch (err) {
    await releaseEnvelopeReservation(submissionId, user.id, { reason: 'canonical_download_failed' });
    console.error('send-for-signature: canonical download failed', err?.message);
    return res.status(500).json({ error: 'canonical_download_failed' });
  }
  const actualHash = sha256HexOfBytes(pdfBytes);
  if (actualHash !== reservedRow.pdf_sha256) {
    await releaseEnvelopeReservation(submissionId, user.id, { reason: 'canonical_hash_mismatch' });
    return res.status(500).json({ error: 'canonical_hash_mismatch' });
  }

  let docusignConfig;
  try {
    docusignConfig = getDocusignConfig();
  } catch (err) {
    await releaseEnvelopeReservation(submissionId, user.id, { reason: 'docusign_config' });
    console.error('send-for-signature: docusign config', err?.message);
    return res.status(500).json({ error: 'docusign_environment_misconfigured' });
  }

  if (!process.env.DOCUSIGN_INTEGRATION_KEY) {
    const mockEnvelopeId = `dev-mock-${submissionId.slice(4, 12)}`;
    const updated = await updateSubmission(submissionId, {
      docusign_envelope_id: mockEnvelopeId,
      docusign_status: 'sent',
    });
    return res.status(200).json({
      ok: true,
      envelopeId: mockEnvelopeId,
      status: 'sent',
      environment: docusignConfig.environment,
      submission: toClientView(updated),
      message: 'Dev mock — no actual request sent',
    });
  }

  let runtime;
  try {
    runtime = await resolveDocusignRuntime();
  } catch (err) {
    await releaseEnvelopeReservation(submissionId, user.id, { reason: 'docusign_bootstrap_failed' });
    console.error('send-for-signature: docusign bootstrap failed', err?.message);
    return res.status(500).json({ error: 'docusign_bootstrap_failed' });
  }

  const transactionId = transactionIdForSubmission(submissionId);
  const envelope = buildEnvelope({
    roaType: reservedRow.roa_type,
    signerName,
    signerEmail,
    brokerName,
    brokerEmail,
    pdfBase64: pdfBytes.toString('base64'),
    pdfFilename: `${submissionId}-canonical.pdf`,
    transactionId,
    subject,
    message,
  });

  let response;
  try {
    response = await fetch(
      `${runtime.accountBaseUrl}/v2.1/accounts/${runtime.accountId}/envelopes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${runtime.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envelope),
      },
    );
  } catch (err) {
    console.error('send-for-signature: envelope response lost', err?.message);
    return reconcileAmbiguousSend({ submissionId, user, row: reservedRow, runtime, res });
  }

  const data = await response.json().catch(() => null);

  if (!response.ok && response.status < 500) {
    await releaseEnvelopeReservation(submissionId, user.id, {
      reason: `docusign_http_${response.status}`,
    });
    console.error('send-for-signature: DocuSign envelope rejected', data);
    return res.status(response.status).json({
      error: data?.message || data?.errorCode || 'Failed to create DocuSign envelope',
    });
  }

  if (!response.ok || !data?.envelopeId) {
    return reconcileAmbiguousSend({ submissionId, user, row: reservedRow, runtime, res });
  }

  const updated = await updateSubmission(submissionId, {
    docusign_envelope_id: data.envelopeId,
    docusign_status: data.status || 'sent',
  });
  return res.status(200).json({
    ok: true,
    envelopeId: data.envelopeId,
    status: data.status || 'sent',
    environment: runtime.config.environment,
    submission: toClientView(updated),
    message: `Signature request sent to ${signerEmail}. ${brokerName} will countersign after client.`,
  });
}
