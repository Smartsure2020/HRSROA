import {
  getConfiguredBaseUrlOverride,
  getDocusignConfig,
} from './docusignConfig.js';
import { resolveDocusignAccountBaseUrl } from './docusignAccount.js';
import { getDocusignAccessToken } from './docusignJwt.js';
import {
  StoragePaths,
  ensurePdfStored,
  setCompletionIfMissing,
  updateSubmission,
} from './submissionRepo.js';
import { sha256HexOfBytes } from './sha256.js';
import { refreshViaDocumenso } from './documensoSigning.js';
import {
  shouldReconcileSigningRecord,
  signingProviderFor,
} from './signingLifecycle.js';

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
  return Buffer.from(await response.arrayBuffer());
}

async function reconcileViaDocusign({ submissionId, row, brokerUserId }) {
  if (!process.env.DOCUSIGN_INTEGRATION_KEY) {
    return { row, refreshed: false, provider: 'docusign', message: 'Dev mock — no DocuSign refresh performed' };
  }

  const config = getDocusignConfig();
  const accessToken = await getDocusignAccessToken(config.authServer);
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  if (!accountId) throw new Error('DOCUSIGN_ACCOUNT_ID is not configured');
  const override = getConfiguredBaseUrlOverride();
  const accountBaseUrl = override
    ? override.replace(/\/+$/, '')
    : (await resolveDocusignAccountBaseUrl({ authServer: config.authServer, accessToken, accountId })).baseUrl;
  const envelopeUrl = `${accountBaseUrl}/v2.1/accounts/${accountId}/envelopes/${row.docusign_envelope_id}`;
  const envelope = await docusignGetJson(envelopeUrl, accessToken);
  const observedStatus = String(envelope?.status || '').toLowerCase();
  const patch = {};
  if (observedStatus) patch.docusign_status = observedStatus;

  const lifecycleStatus = LIFECYCLE_STATUS_FROM_DOCUSIGN[observedStatus];
  if (lifecycleStatus && lifecycleStatus !== row.status) patch.status = lifecycleStatus;
  if (observedStatus === 'completed' && !row.completed_at) {
    await setCompletionIfMissing(submissionId, brokerUserId, new Date().toISOString());
  }

  let signedRetrieved = Boolean(row.signed_pdf_storage_path);
  let certificateRetrieved = Boolean(row.certificate_storage_path);
  const evidenceErrors = [];

  if (observedStatus === 'completed') {
    if (!signedRetrieved) {
      try {
        const bytes = await docusignGetPdf(`${envelopeUrl}/documents/combined`, accessToken);
        const path = StoragePaths.signed(submissionId);
        const hash = sha256HexOfBytes(bytes);
        await ensurePdfStored(path, bytes, { expectedSha256: hash });
        patch.signed_pdf_storage_path = path;
        patch.signed_pdf_sha256 = hash;
        signedRetrieved = true;
      } catch (err) {
        console.error('reconcile: DocuSign signed doc retrieval failed', err?.message);
        evidenceErrors.push('signed');
      }
    }
    if (!certificateRetrieved) {
      try {
        const bytes = await docusignGetPdf(`${envelopeUrl}/documents/certificate`, accessToken);
        const path = StoragePaths.certificate(submissionId);
        const hash = sha256HexOfBytes(bytes);
        await ensurePdfStored(path, bytes, { expectedSha256: hash });
        patch.certificate_storage_path = path;
        patch.certificate_sha256 = hash;
        certificateRetrieved = true;
      } catch (err) {
        console.error('reconcile: DocuSign certificate retrieval failed', err?.message);
        evidenceErrors.push('certificate');
      }
    }
    if (signedRetrieved && certificateRetrieved && !row.evidence_retrieved_at) {
      patch.evidence_retrieved_at = new Date().toISOString();
    }
  }

  const updated = Object.keys(patch).length ? await updateSubmission(submissionId, patch) : row;
  return {
    row: updated,
    provider: 'docusign',
    refreshed: true,
    observedStatus,
    evidenceErrors,
  };
}

export async function reconcileSigningSubmission({ submissionId, row, brokerUserId }) {
  if (!shouldReconcileSigningRecord(row)) {
    return { row, provider: signingProviderFor(row), refreshed: false, skipped: true };
  }

  if (signingProviderFor(row) === 'documenso') {
    const result = await refreshViaDocumenso({ submissionId, row, brokerUserId });
    return { ...result, provider: 'documenso' };
  }

  if (!row.docusign_envelope_id) {
    return { row, provider: signingProviderFor(row), refreshed: false, skipped: true };
  }
  return reconcileViaDocusign({ submissionId, row, brokerUserId });
}
