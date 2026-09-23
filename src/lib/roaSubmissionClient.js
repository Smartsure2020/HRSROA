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
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `${url} failed (${res.status})`);
  return data;
}

async function getJson(url) {
  const res = await fetch(url, {
    method: 'GET',
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

export async function createSubmission({ submissionId, roaType, snapshot, versions, pdfBytes }) {
  if (!isSubmissionId(submissionId)) throw new Error('createSubmission: invalid submissionId');
  return postJson('/api/roa-submissions/create', {
    submissionId,
    roaType,
    snapshot,
    versions,
    pdfBase64: bytesToBase64(pdfBytes),
  });
}

export async function getSubmission(submissionId) {
  const encoded = encodeURIComponent(submissionId);
  const data = await getJson(`/api/roa-submissions/get?id=${encoded}`);
  return data.submission;
}

export async function refreshSubmission(submissionId) {
  const data = await postJson('/api/roa-submissions/refresh', { submissionId });
  return data.submission;
}

export async function attachCrmIds(submissionId, { crmClientId, crmDealId }) {
  const data = await postJson('/api/roa-submissions/attach-crm', { submissionId, crmClientId, crmDealId });
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

export async function sendNotificationEmail({ submissionId, to, subject, body }) {
  return postJson('/api/roa-submissions/notify-email', { submissionId, to, subject, body });
}

/** Triggers a browser download of canonical / signed / certificate / audit evidence. */
export async function downloadEvidencePdf(submissionId, kind = 'canonical', suggestedFilename) {
  const url = `/api/roa-submissions/pdf?id=${encodeURIComponent(submissionId)}&kind=${encodeURIComponent(kind)}`;
  const res = await fetch(url, { headers: { ...(await authHeader()) } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Download ${kind} failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = suggestedFilename || `${submissionId}-${kind}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}
