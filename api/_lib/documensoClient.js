// Server-only Documenso API adapter for HRS ROA.
//
// Documenso is the signing provider only. The authoritative ROA snapshot,
// canonical PDF and retained evidence continue to live in HRS/Supabase.
//
// Required server env:
//   DOCUMENSO_API_URL   e.g. https://sign.hrsinsurance.co.za/api/v2
//   DOCUMENSO_API_TOKEN team API token (server-only)

import { SIGNATURE_MARKERS } from '../../src/lib/pdf/signatureLabels.js';

export class DocumensoApiError extends Error {
  constructor(message, { status = null, body = null } = {}) {
    super(message);
    this.name = 'DocumensoApiError';
    this.status = status;
    this.body = body;
  }
}

export function isDocumensoConfigured() {
  return Boolean(process.env.DOCUMENSO_API_URL && process.env.DOCUMENSO_API_TOKEN);
}

export function getDocumensoConfig() {
  const apiUrl = String(process.env.DOCUMENSO_API_URL || '').replace(/\/+$/, '');
  const apiToken = process.env.DOCUMENSO_API_TOKEN;

  if (!apiUrl || !apiToken) {
    throw new Error('Documenso is not configured: DOCUMENSO_API_URL and DOCUMENSO_API_TOKEN are required');
  }

  return { apiUrl, apiToken };
}

function authHeaders(config, extra = {}) {
  return {
    Authorization: `Bearer ${config.apiToken}`,
    ...extra,
  };
}

async function readErrorBody(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => ({}));
  }
  return response.text().catch(() => '');
}

async function requestJson(path, { method = 'GET', body, config = getDocumensoConfig() } = {}) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: authHeaders(config, body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    const message =
      errorBody?.message
      || errorBody?.error
      || errorBody?.code
      || (typeof errorBody === 'string' && errorBody)
      || `Documenso request failed (${response.status})`;
    throw new DocumensoApiError(String(message), { status: response.status, body: errorBody });
  }

  return response.json().catch(() => ({}));
}

async function requestPdf(path, { config = getDocumensoConfig() } = {}) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'GET',
    headers: authHeaders(config, { Accept: 'application/pdf' }),
  });

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    const message =
      errorBody?.message
      || errorBody?.error
      || (typeof errorBody === 'string' && errorBody)
      || `Documenso PDF request failed (${response.status})`;
    throw new DocumensoApiError(String(message), { status: response.status, body: errorBody });
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function findEnvelopeByExternalId(externalId, { config = getDocumensoConfig() } = {}) {
  const query = new URLSearchParams({
    query: externalId,
    type: 'DOCUMENT',
    perPage: '20',
  });

  const result = await requestJson(`/envelope?${query.toString()}`, { config });
  const matches = Array.isArray(result?.data)
    ? result.data.filter((item) => item?.externalId === externalId)
    : [];

  if (matches.length > 1) {
    throw new DocumensoApiError(
      `Multiple Documenso envelopes found for externalId ${externalId}; manual reconciliation required`,
      { body: { envelopeIds: matches.map((item) => item.id) } },
    );
  }

  return matches[0] || null;
}

export async function getEnvelope(envelopeId, { config = getDocumensoConfig() } = {}) {
  return requestJson(`/envelope/${encodeURIComponent(envelopeId)}`, { config });
}

export async function createEnvelopeDraft({
  submissionId,
  roaType,
  signerName,
  signerEmail,
  brokerName,
  brokerEmail,
  pdfBytes,
  subject,
  message,
  config = getDocumensoConfig(),
}) {
  const payload = {
    type: 'DOCUMENT',
    title: `HRS ${roaType} ROA – ${submissionId}`,
    externalId: submissionId,
    recipients: [
      {
        email: signerEmail,
        name: signerName,
        role: 'SIGNER',
        signingOrder: 1,
      },
      {
        email: brokerEmail,
        name: brokerName,
        role: 'SIGNER',
        signingOrder: 2,
      },
    ],
    meta: {
      subject: subject || `Please sign your HRS ${roaType} Record of Advice`,
      message: message || 'Please review and sign your Record of Advice. Your HRS advisor will countersign after you.',
      distributionMethod: 'EMAIL',
      signingOrder: 'SEQUENTIAL',
      allowDictateNextSigner: false,
      typedSignatureEnabled: true,
      uploadSignatureEnabled: true,
      drawSignatureEnabled: true,
      language: 'en',
      emailReplyTo: brokerEmail,
    },
  };

  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  form.append(
    'files',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    `${submissionId}-canonical.pdf`,
  );

  const response = await fetch(`${config.apiUrl}/envelope/create`, {
    method: 'POST',
    headers: authHeaders(config),
    body: form,
  });

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    const message =
      errorBody?.message
      || errorBody?.error
      || (typeof errorBody === 'string' && errorBody)
      || `Documenso create failed (${response.status})`;
    throw new DocumensoApiError(String(message), { status: response.status, body: errorBody });
  }

  const data = await response.json().catch(() => ({}));
  if (!data?.id) {
    throw new DocumensoApiError('Documenso create returned no envelope id', { body: data });
  }

  return data.id;
}

/**
 * Create or recover the provider envelope using ROA submissionId as externalId.
 * If the create response is lost, re-query by externalId before surfacing the
 * error so a retry never blindly creates a duplicate.
 */
export async function ensureEnvelopeCreated(args) {
  const config = args.config || getDocumensoConfig();
  const existing = await findEnvelopeByExternalId(args.submissionId, { config });
  if (existing?.id) return getEnvelope(existing.id, { config });

  try {
    const envelopeId = await createEnvelopeDraft({ ...args, config });
    return getEnvelope(envelopeId, { config });
  } catch (err) {
    try {
      const recovered = await findEnvelopeByExternalId(args.submissionId, { config });
      if (recovered?.id) return getEnvelope(recovered.id, { config });
    } catch (reconcileErr) {
      err.reconciliationError = reconcileErr;
    }
    throw err;
  }
}

function findRecipient(envelope, email) {
  const target = String(email || '').toLowerCase();
  return envelope?.recipients?.find((r) => String(r.email || '').toLowerCase() === target) || null;
}

const REQUIRED_FIELDS = Object.freeze([
  { who: 'client', type: 'SIGNATURE', marker: SIGNATURE_MARKERS.clientSignature, width: 32, height: 6 },
  { who: 'client', type: 'DATE', marker: SIGNATURE_MARKERS.clientDate, width: 20, height: 2.5 },
  { who: 'advisor', type: 'SIGNATURE', marker: SIGNATURE_MARKERS.advisorSignature, width: 32, height: 6 },
  { who: 'advisor', type: 'DATE', marker: SIGNATURE_MARKERS.advisorDate, width: 20, height: 2.5 },
]);

export async function ensureRoaFields(
  envelope,
  { signerEmail, brokerEmail, config = getDocumensoConfig() },
) {
  const client = findRecipient(envelope, signerEmail);
  const advisor = findRecipient(envelope, brokerEmail);
  if (!client || !advisor) {
    throw new DocumensoApiError('Documenso envelope recipients do not match the ROA client/advisor');
  }

  const expected = REQUIRED_FIELDS.map((field) => ({
    ...field,
    recipientId: field.who === 'client' ? client.id : advisor.id,
  }));

  const currentFields = Array.isArray(envelope?.fields) ? envelope.fields : [];
  const missing = expected.filter(
    (field) => !currentFields.some(
      (existing) => existing.recipientId === field.recipientId && existing.type === field.type,
    ),
  );

  if (missing.length === 0) return envelope;

  // If some fields exist and others do not, avoid guessing after a partial
  // provider mutation; the hidden markers may already have been removed.
  if (currentFields.length > 0) {
    throw new DocumensoApiError('Documenso envelope has a partial ROA field set; manual reconciliation required');
  }

  await requestJson('/envelope/field/create-many', {
    method: 'POST',
    config,
    body: {
      envelopeId: envelope.id,
      data: missing.map((field) => ({
        type: field.type,
        recipientId: field.recipientId,
        placeholder: field.marker,
        width: field.width,
        height: field.height,
      })),
    },
  });

  return getEnvelope(envelope.id, { config });
}

export async function ensureEnvelopeDistributed(
  envelope,
  { subject, message, config = getDocumensoConfig() } = {},
) {
  const status = String(envelope?.status || '').toUpperCase();

  if (status === 'PENDING' || status === 'COMPLETED' || status === 'REJECTED' || status === 'CANCELLED') {
    return envelope;
  }
  if (status !== 'DRAFT') {
    throw new DocumensoApiError(`Unsupported Documenso envelope status: ${status || '(empty)'}`);
  }

  await requestJson('/envelope/distribute', {
    method: 'POST',
    config,
    body: {
      envelopeId: envelope.id,
      meta: {
        ...(subject ? { subject } : {}),
        ...(message ? { message } : {}),
        distributionMethod: 'EMAIL',
      },
    },
  });

  return getEnvelope(envelope.id, { config });
}

export async function downloadSignedPdf(envelope, { config = getDocumensoConfig() } = {}) {
  const firstItem = envelope?.envelopeItems?.[0];
  if (!firstItem?.id) throw new DocumensoApiError('Documenso envelope has no PDF item');
  return requestPdf(
    `/envelope/item/${encodeURIComponent(firstItem.id)}/download?version=signed`,
    { config },
  );
}

export async function downloadCertificatePdf(envelopeId, { config = getDocumensoConfig() } = {}) {
  return requestPdf(
    `/envelope/${encodeURIComponent(envelopeId)}/certificate/download`,
    { config },
  );
}

export async function downloadAuditLogPdf(envelopeId, { config = getDocumensoConfig() } = {}) {
  return requestPdf(
    `/envelope/${encodeURIComponent(envelopeId)}/audit-log/download`,
    { config },
  );
}
