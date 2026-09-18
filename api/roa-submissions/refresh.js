// POST /api/roa-submissions/refresh — poll DocuSign for the submission's
// envelope and, on completion, retrieve + store the signed document and the
// Certificate of Completion (Phase ROA-1 §17-§20).
//
// Contract:
//   • Broker-scoped (owner-only, 404 otherwise).
//   • No envelope on the row → return current state, no external call.
//   • DocuSign status persisted as-observed (`sent`, `delivered`, `completed`,
//     `declined`, `voided`, `expired`). No invented states.
//   • On `completed`:
//       – download combined signed PDF → store at signed.pdf (hash recorded).
//       – download certificate of completion → store at certificate.pdf.
//       – Persist completed_at (first observation) and, only when BOTH
//         artefacts are stored, evidence_retrieved_at.
//   • Partial retrieval failure is safe to retry — the row is NOT marked
//     "fully retrieved" if only one of the two artefacts landed.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import {
  getConfiguredBaseUrlOverride,
  getDocusignConfig,
} from '../_lib/docusignConfig.js';
import { resolveDocusignAccountBaseUrl } from '../_lib/docusignAccount.js';
import { getDocusignAccessToken } from '../_lib/docusignJwt.js';
import {
  loadSubmissionForBroker,
  StoragePaths,
  ensurePdfStored,
  updateSubmission,
} from '../_lib/submissionRepo.js';
import { sha256HexOfBytes } from '../_lib/sha256.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { toClientView } from './get.js';

const LIFECYCLE_STATUS_FROM_DOCUSIGN = {
  sent: 'awaiting_signature',
  delivered: 'awaiting_signature',
  completed: 'completed',
  declined: 'declined',
  voided: 'voided',
  expired: 'expired',
};

async function docusignGetJson(url, accessToken) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.message || data?.errorCode || `DocuSign GET ${response.status}`);
    err.status = response.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function docusignGetPdf(url, accessToken) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/pdf' },
  });
  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch { /* ignore */ }
    const err = new Error(`DocuSign PDF GET ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    err.status = response.status;
    throw err;
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const { submissionId } = req.body ?? {};
  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'Invalid submissionId' });

  const row = await loadSubmissionForBroker(submissionId, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (!row.docusign_envelope_id) {
    return res.status(200).json({ ok: true, submission: toClientView(row), refreshed: false });
  }

  // Terminal states with all evidence already stored — nothing to do.
  if (row.status === 'completed' && row.signed_pdf_storage_path && row.certificate_storage_path) {
    return res.status(200).json({ ok: true, submission: toClientView(row), refreshed: false });
  }

  // Dev mock — no DocuSign credentials configured. Refresh is a no-op in
  // dev; the client can still exercise the checklist UI.
  if (!process.env.DOCUSIGN_INTEGRATION_KEY) {
    return res.status(200).json({
      ok: true,
      submission: toClientView(row),
      refreshed: false,
      message: 'Dev mock — no DocuSign refresh performed',
    });
  }

  let docusignConfig;
  try { docusignConfig = getDocusignConfig(); }
  catch (err) {
    console.error('refresh: docusign config', err?.message);
    return res.status(500).json({ error: 'docusign_environment_misconfigured' });
  }

  let accessToken;
  let accountBaseUrl;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  try {
    accessToken = await getDocusignAccessToken(docusignConfig.authServer);
    if (!accountId) throw new Error('DOCUSIGN_ACCOUNT_ID is not configured');
    const override = getConfiguredBaseUrlOverride();
    accountBaseUrl = override
      ? override.replace(/\/+$/, '')
      : (await resolveDocusignAccountBaseUrl({
          authServer: docusignConfig.authServer,
          accessToken,
          accountId,
        })).baseUrl;
  } catch (err) {
    console.error('refresh: docusign bootstrap failed', err?.message);
    return res.status(500).json({ error: err?.message || 'docusign_bootstrap_failed' });
  }

  const envelopeUrl = `${accountBaseUrl}/v2.1/accounts/${accountId}/envelopes/${row.docusign_envelope_id}`;

  let envelope;
  try { envelope = await docusignGetJson(envelopeUrl, accessToken); }
  catch (err) {
    console.error('refresh: envelope status fetch failed', err?.message);
    return res.status(500).json({ error: 'docusign_status_failed' });
  }

  const observedStatus = String(envelope?.status || '').toLowerCase();
  const patch = {};
  if (observedStatus) patch.docusign_status = observedStatus;

  const lifecycleStatus = LIFECYCLE_STATUS_FROM_DOCUSIGN[observedStatus];
  if (lifecycleStatus && lifecycleStatus !== row.status) patch.status = lifecycleStatus;

  // completed_at has one meaning only: DocuSign actually reached completed.
  if (observedStatus === 'completed' && !row.completed_at) {
    patch.completed_at = new Date().toISOString();
  }

  let signedRetrieved = Boolean(row.signed_pdf_storage_path);
  let certificateRetrieved = Boolean(row.certificate_storage_path);
  let evidenceErrors = [];

  if (observedStatus === 'completed') {
    if (!signedRetrieved) {
      try {
        const signedBytes = await docusignGetPdf(`${envelopeUrl}/documents/combined`, accessToken);
        const signedPath = StoragePaths.signed(submissionId);
        const signedHash = sha256HexOfBytes(signedBytes);
        await ensurePdfStored(signedPath, signedBytes, { expectedSha256: signedHash });
        patch.signed_pdf_storage_path = signedPath;
        patch.signed_pdf_sha256 = signedHash;
        signedRetrieved = true;
      } catch (err) {
        console.error('refresh: signed doc retrieval failed', err?.message);
        evidenceErrors.push('signed');
      }
    }
    if (!certificateRetrieved) {
      try {
        const certBytes = await docusignGetPdf(`${envelopeUrl}/documents/certificate`, accessToken);
        const certPath = StoragePaths.certificate(submissionId);
        const certificateHash = sha256HexOfBytes(certBytes);
        await ensurePdfStored(certPath, certBytes, { expectedSha256: certificateHash });
        patch.certificate_storage_path = certPath;
        patch.certificate_sha256 = certificateHash;
        certificateRetrieved = true;
      } catch (err) {
        console.error('refresh: certificate retrieval failed', err?.message);
        evidenceErrors.push('certificate');
      }
    }
    // Only mark evidence fully retrieved once BOTH artefacts are stored.
    if (signedRetrieved && certificateRetrieved && !row.evidence_retrieved_at) {
      patch.evidence_retrieved_at = new Date().toISOString();
    }
  }

  const updated = Object.keys(patch).length > 0
    ? await updateSubmission(submissionId, patch)
    : row;

  return res.status(200).json({
    ok: true,
    submission: toClientView(updated),
    refreshed: true,
    observedStatus,
    evidenceErrors: evidenceErrors.length ? evidenceErrors : undefined,
  });
}
