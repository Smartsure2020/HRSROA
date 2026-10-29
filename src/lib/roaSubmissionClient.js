// Browser-side client for the ROA submission endpoints (Phase ROA-1).
//
// A single place the wizard and checklist screens call — keeps each fetch
// small and consistent (auth header, JSON body, JSON response). Never
// regenerates the PDF: after `createSubmission` returns, downstream
// operations only take a submissionId.

import { authHeader } from './apiAuth';
import { isSubmissionId } from './roaSubmissionSnapshot';

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `${url} failed (${res.status})`);
    // Machine-readable detail so a screen can react to a specific refusal (for example an
    // amendment gate) without parsing the message.
    err.code = data?.error;
    err.data = data;
    throw err;
  }
  return data;
}

async function getJson(url) {
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: { ...(await authHeader()) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `${url} failed (${res.status})`);
  return data;
}

/** Encode Uint8Array → base64 for JSON transport. */
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Freezes a submission. Pass `amendment` ({ supersedesSubmissionId, reason, reasonDetail })
 * to create the next REVISION of an existing ROA; the server derives the revision number,
 * lineage and amender itself.
 */
export async function createSubmission({ submissionId, roaType, snapshot, versions, pdfBytes, amendment }) {
  if (!isSubmissionId(submissionId)) throw new Error('createSubmission: invalid submissionId');
  return postJson('/api/roa-submissions/create', {
    submissionId,
    roaType,
    snapshot,
    versions,
    pdfBase64: bytesToBase64(pdfBytes),
    ...(amendment ? { amendment } : {}),
  });
}

/**
 * Owner-only read of the frozen source snapshot an amendment starts from. Throws an Error
 * whose `.code` is the server's reason ('already_superseded', 'not_found', …) when the ROA
 * cannot be amended.
 */
export async function getAmendmentSource(submissionId) {
  if (!isSubmissionId(submissionId)) throw new Error('getAmendmentSource: invalid submissionId');
  const res = await fetch(
    `/api/roa-submissions/get?id=${encodeURIComponent(submissionId)}&view=amendment`,
    { method: 'GET', cache: 'no-store', headers: { ...(await authHeader()) } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Amendment source failed (${res.status})`);
    err.code = data?.error || 'amendment_source_failed';
    throw err;
  }
  return data.amendment;
}

export async function getSubmission(submissionId) {
  const encoded = encodeURIComponent(submissionId);
  const data = await getJson(`/api/roa-submissions/get?id=${encoded}`);
  return data.submission;
}

export async function listSubmissions() {
  const data = await getJson('/api/roa-submissions/list');
  return data.submissions || [];
}

export function isPendingSubmission(item) {
  if (!item?.signingEnvelopeId && !item?.docusignEnvelopeId) return false;
  if (['declined', 'voided', 'expired'].includes(item.status)) return false;
  const evidenceComplete = item.hasSignedPdf
    && item.hasCertificate
    && (item.signingProvider !== 'documenso' || item.hasAuditLog);
  return item.status !== 'completed' || !evidenceComplete;
}

export async function reconcilePendingSubmissions() {
  return postJson('/api/roa-submissions/reconcile-pending', {});
}

/** Initial load: discover pending rows, reconcile if needed, then return fresh state. */
export async function loadSubmissionRegister() {
  const initial = await listSubmissions();
  if (!initial.some(isPendingSubmission)) return initial;
  await reconcilePendingSubmissions();
  return listSubmissions();
}

/** Manual/poll refresh: reconcile first so stale stored state is never displayed as fresh. */
export async function refreshSubmissionRegister() {
  await reconcilePendingSubmissions();
  return listSubmissions();
}

export async function refreshSubmission(submissionId) {
  const data = await postJson('/api/roa-submissions/refresh', { submissionId });
  return data.submission;
}

export async function syncCrmSubmission(submissionId) {
  if (!isSubmissionId(submissionId)) throw new Error('syncCrmSubmission: invalid submissionId');
  const data = await postJson('/api/roa-submissions/sync-crm', { submissionId });
  return data.submission;
}

export async function sendForSignature({ submissionId, signerName, signerEmail, subject, message }) {
  return postJson('/api/roa-submissions/send-for-signature', {
    submissionId,
    signerName,
    signerEmail,
    subject,
    message,
  });
}

/** Re-sends the signing email on the existing envelope; never creates a new one. */
export async function sendSignatureReminder(submissionId) {
  if (!isSubmissionId(submissionId)) throw new Error('sendSignatureReminder: invalid submissionId');
  return postJson('/api/roa-submissions/send-reminder', { submissionId });
}

export async function sendNotificationEmail({ submissionId, to, subject, body }) {
  return postJson('/api/roa-submissions/notify-email', { submissionId, to, subject, body });
}

/** Triggers a browser download of canonical, signed, certificate, or audit-log evidence. */
export async function downloadEvidencePdf(submissionId, kind = 'canonical', suggestedFilename) {
  const url = `/api/roa-submissions/pdf?id=${encodeURIComponent(submissionId)}&kind=${encodeURIComponent(kind)}`;
  const res = await fetch(url, { headers: { ...(await authHeader()) } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Download ${kind} failed (${res.status})`);
  }
  const blob = await res.blob();
  const contentDisposition = res.headers.get('content-disposition') || '';
  const encodedFilename = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quotedFilename = contentDisposition.match(/filename="([^"]+)"/i)?.[1];
  let serverFilename = '';
  try {
    serverFilename = encodedFilename ? decodeURIComponent(encodedFilename) : (quotedFilename || '');
  } catch {
    serverFilename = quotedFilename || '';
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = suggestedFilename || serverFilename || `${submissionId}-${kind}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}
