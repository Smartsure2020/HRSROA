// POST /api/roa-submissions/send-for-signature — create the DocuSign envelope
// for a submission's canonical PDF (Phase ROA-1).
//
// Idempotency contract (spec §15):
//   • Once `docusign_envelope_id` exists, another Send request MUST NOT
//     create a second envelope. Return the existing envelope + status.
//   • Concurrency is handled via reserveEnvelopeSlot(), an atomic UPDATE
//     that transitions `submitted` (or `signature_failed`) → `awaiting_
//     signature` only when no envelope id is present. Only the winning
//     caller proceeds to DocuSign.
//
// Canonical PDF contract (spec §14):
//   • The PDF sent to DocuSign comes from Storage, not from the request.
//   • Its SHA-256 is verified against roa_submissions.pdf_sha256 before
//     the envelope is created.
//
// Broker identity contract:
//   • The caller must own the submission (advisor_user_id = user.id).
//   • The broker record on the envelope comes from BROKER_EMAIL_MAP,
//     keyed off the authenticated user.

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

  // Idempotent short-circuit: envelope already exists → return it, don't
  // create a second one.
  if (row.docusign_envelope_id) {
    return res.status(200).json({
      ok: true,
      alreadySent: true,
      envelopeId: row.docusign_envelope_id,
      status: row.docusign_status,
      submission: toClientView(row),
    });
  }

  // Reserve the envelope slot atomically. If another caller (double-click,
  // page reload) already reserved OR completed a send, we won't reach the
  // DocuSign call — we return the current row instead.
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
    // Concurrent reservation — someone else is mid-flight. Return the
    // current state so the client can poll for the outcome.
    return res.status(409).json({
      ok: false,
      error: 'send_in_progress',
      submission: toClientView(current),
    });
  }

  const reservedRow = reservation.row;

  // The broker record on the envelope is derived from the authenticated
  // user, not from the client body — brokers can only sign as themselves.
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

  // Load canonical bytes from Storage and verify SHA-256 before shipping.
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
  const pdfBase64 = pdfBytes.toString('base64');
  const pdfFilename = `${submissionId}-canonical.pdf`;

  let docusignConfig;
  try { docusignConfig = getDocusignConfig(); }
  catch (err) {
    await releaseEnvelopeReservation(submissionId, user.id, { reason: 'docusign_config' });
    console.error('send-for-signature: docusign config', err?.message);
    return res.status(500).json({ error: 'docusign_environment_misconfigured' });
  }

  // Dev mock — after all validation, before any real DocuSign contact.
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

  try {
    const accessToken = await getDocusignAccessToken(docusignConfig.authServer);
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    if (!accountId) throw new Error('DOCUSIGN_ACCOUNT_ID is not configured');

    const override = getConfiguredBaseUrlOverride();
    const accountBaseUrl = override
      ? override.replace(/\/+$/, '')
      : (await resolveDocusignAccountBaseUrl({
          authServer: docusignConfig.authServer,
          accessToken,
          accountId,
        })).baseUrl;

    const envelope = buildEnvelope({
      roaType: reservedRow.roa_type,
      signerName,
      signerEmail,
      brokerName,
      brokerEmail,
      pdfBase64,
      pdfFilename,
      subject,
      message,
    });

    const response = await fetch(
      `${accountBaseUrl}/v2.1/accounts/${accountId}/envelopes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envelope),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await releaseEnvelopeReservation(submissionId, user.id, { reason: `docusign_http_${response.status}` });
      console.error('send-for-signature: DocuSign envelope error', data);
      return res.status(response.status).json({
        error: data?.message || data?.errorCode || 'Failed to create DocuSign envelope',
      });
    }

    const updated = await updateSubmission(submissionId, {
      docusign_envelope_id: data.envelopeId,
      docusign_status: data.status || 'sent',
    });
    return res.status(200).json({
      ok: true,
      envelopeId: data.envelopeId,
      status: data.status || 'sent',
      environment: docusignConfig.environment,
      submission: toClientView(updated),
      message: `Signature request sent to ${signerEmail}. ${brokerName} will countersign after client.`,
    });
  } catch (err) {
    // NOTE: leaves the row in 'awaiting_signature' with envelope_id NULL on
    // network-ambiguous errors — treated as a reconciliation-needed state.
    await releaseEnvelopeReservation(submissionId, user.id, { reason: (err?.message || 'unknown').slice(0, 80) });
    console.error('send-for-signature error:', err?.message);
    return res.status(500).json({ error: err?.message || 'Internal server error' });
  }
}
