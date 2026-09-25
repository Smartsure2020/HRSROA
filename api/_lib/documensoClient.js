import { SIGNING_MARKERS } from '../../src/lib/pdf/signingMarkers.js';

function getConfig() {
  const baseUrl = String(process.env.DOCUMENSO_BASE_URL || '').replace(/\/+$/, '');
  const apiToken = process.env.DOCUMENSO_API_TOKEN;

  if (!baseUrl) throw new Error('DOCUMENSO_BASE_URL is not configured');
  if (!apiToken) throw new Error('DOCUMENSO_API_TOKEN is not configured');

  return {
    apiBase: `${baseUrl}/api/v2`,
    apiToken,
  };
}

async function parseError(response) {
  const body = await response.json().catch(async () => {
    const text = await response.text().catch(() => '');
    return text ? { error: text.slice(0, 500) } : {};
  });
  const err = new Error(body?.message || body?.error || `Documenso HTTP ${response.status}`);
  err.status = response.status;
  err.body = body;
  return err;
}

async function jsonRequest(path, options = {}) {
  const { apiBase, apiToken } = getConfig();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${apiToken}`);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('Accept', 'application/json');

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

async function pdfRequest(path) {
  const { apiBase, apiToken } = getConfig();
  const response = await fetch(`${apiBase}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/pdf',
    },
  });
  if (!response.ok) throw await parseError(response);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function createDocumensoEnvelope({
  submissionId,
  pdfBytes,
  filename,
  signerName,
  signerEmail,
  brokerName,
  brokerEmail,
  subject,
  message,
}) {
  const { apiBase, apiToken } = getConfig();

  const payload = {
    type: 'DOCUMENT',
    title: `HRS Record of Advice — ${submissionId}`,
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
      subject: subject || `Please sign your Record of Advice — HRS Insurance`,
      message: message || 'Please review and sign your Record of Advice.',
      distributionMethod: 'EMAIL',
      signingOrder: 'SEQUENTIAL',
      allowDictateNextSigner: false,
      language: 'en',
      typedSignatureEnabled: true,
      uploadSignatureEnabled: true,
      drawSignatureEnabled: true,
      emailReplyTo: brokerEmail,
    },
  };

  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  form.append(
    'files',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    filename,
  );

  const response = await fetch(`${apiBase}/envelope/create`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
    },
    body: form,
  });

  if (!response.ok) throw await parseError(response);
  const created = await response.json();
  if (!created?.id) throw new Error('Documenso create returned no envelope id');
  return created.id;
}

export async function getDocumensoEnvelope(envelopeId) {
  return jsonRequest(`/envelope/${encodeURIComponent(envelopeId)}`, { method: 'GET' });
}

export async function findDocumensoEnvelopeByExternalId(externalId) {
  const result = await jsonRequest(
    `/envelope?type=DOCUMENT&query=${encodeURIComponent(externalId)}&perPage=100`,
    { method: 'GET' },
  );
  const rows = Array.isArray(result?.data) ? result.data : [];
  return rows.find((row) => row?.externalId === externalId) || null;
}

export async function addRoaSigningFields({ envelopeId, envelope }) {
  const recipients = Array.isArray(envelope?.recipients) ? envelope.recipients : [];
  const items = Array.isArray(envelope?.envelopeItems) ? envelope.envelopeItems : [];

  const client = recipients.find((r) => Number(r.signingOrder) === 1) || recipients[0];
  const advisor = recipients.find((r) => Number(r.signingOrder) === 2) || recipients[1];
  const item = items[0];

  if (!client?.id || !advisor?.id) {
    throw new Error('Documenso envelope does not contain both ordered recipients');
  }
  if (!item?.id) {
    throw new Error('Documenso envelope has no PDF item');
  }

  const data = [
    {
      type: 'SIGNATURE',
      recipientId: client.id,
      envelopeItemId: item.id,
      placeholder: SIGNING_MARKERS.clientSignature,
      width: 34,
      height: 8,
      fieldMeta: { type: 'signature', required: true },
    },
    {
      type: 'DATE',
      recipientId: client.id,
      envelopeItemId: item.id,
      placeholder: SIGNING_MARKERS.clientDate,
      width: 18,
      height: 3.5,
      fieldMeta: { type: 'date', required: true },
    },
    {
      type: 'SIGNATURE',
      recipientId: advisor.id,
      envelopeItemId: item.id,
      placeholder: SIGNING_MARKERS.advisorSignature,
      width: 34,
      height: 8,
      fieldMeta: { type: 'signature', required: true },
    },
    {
      type: 'DATE',
      recipientId: advisor.id,
      envelopeItemId: item.id,
      placeholder: SIGNING_MARKERS.advisorDate,
      width: 18,
      height: 3.5,
      fieldMeta: { type: 'date', required: true },
    },
  ];

  const result = await jsonRequest('/envelope/field/create-many', {
    method: 'POST',
    body: JSON.stringify({ envelopeId, data }),
  });

  return {
    fields: result?.data || [],
    envelopeItemId: item.id,
    clientRecipientId: client.id,
    advisorRecipientId: advisor.id,
  };
}

export async function distributeDocumensoEnvelope({ envelopeId, subject, message, brokerEmail }) {
  return jsonRequest('/envelope/distribute', {
    method: 'POST',
    body: JSON.stringify({
      envelopeId,
      meta: {
        subject: subject || 'Please sign your Record of Advice — HRS Insurance',
        message: message || 'Please review and sign your Record of Advice.',
        distributionMethod: 'EMAIL',
        emailReplyTo: brokerEmail,
      },
    }),
  });
}

export async function getDocumensoEnvelopeStatus(envelopeId) {
  const envelope = await getDocumensoEnvelope(envelopeId);
  return {
    raw: envelope,
    status: String(envelope?.status || '').toUpperCase(),
    completedAt: envelope?.completedAt || null,
    envelopeItemId: envelope?.envelopeItems?.[0]?.id || null,
  };
}

export async function downloadDocumensoSignedPdf(envelopeItemId) {
  return pdfRequest(
    `/envelope/item/${encodeURIComponent(envelopeItemId)}/download?version=signed`,
  );
}

export async function downloadDocumensoCertificate(envelopeId) {
  return pdfRequest(
    `/envelope/${encodeURIComponent(envelopeId)}/certificate/download`,
  );
}

export async function downloadDocumensoAuditLog(envelopeId) {
  return pdfRequest(
    `/envelope/${encodeURIComponent(envelopeId)}/audit-log/download`,
  );
}

export function isDocumensoConfigured() {
  return Boolean(process.env.DOCUMENSO_BASE_URL && process.env.DOCUMENSO_API_TOKEN);
}
