import { randomBytes } from 'node:crypto';
import { requireAuthenticatedBroker } from '../_lib/auth.js';
import {
  addFollowupFields, createFollowupEnvelope, distributeDocumensoEnvelope,
  findDocumensoEnvelopeByExternalId, getDocumensoEnvelope, isDocumensoConfigured,
} from '../_lib/documensoClient.js';
import {
  hashAccessToken, isRequestId, ownedFollowup, publicFollowup,
  reserveFollowupSend, updateFollowup, verifiedFollowupBytes,
} from '../_lib/followupRepo.js';
import { maybeSyncFollowupToCrm } from '../_lib/followupCrm.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const broker = await requireAuthenticatedBroker(req, res);
  if (!broker) return;
  const id = req.body?.id;
  if (!isRequestId(id)) return res.status(400).json({ error: 'invalid_request_id' });
  const owned = await ownedFollowup(id, broker);
  if (!owned) return res.status(404).json({ error: 'not_found' });
  if (!isDocumensoConfigured()) return res.status(503).json({ error: 'documenso_not_configured' });
  let row = owned.request;
  if (row.envelope_id && row.status !== 'sending') {
    return res.status(200).json({ request: publicFollowup(row), repeated: true });
  }
  if (!row.envelope_id) {
    const reserved = await reserveFollowupSend(id);
    if (reserved) row = reserved;
    else if (row.status === 'sending' && Date.now() - Date.parse(row.updated_at) > 60_000) {
      try {
        const found = await findDocumensoEnvelopeByExternalId(id);
        if (found?.id) row = await updateFollowup(id, { envelope_id: found.id });
      } catch { /* keep the ambiguous send locked */ }
    }
    if (!reserved && !row.envelope_id) {
      return res.status(409).json({ error: 'send_in_progress' });
    }
  }
  let envelopeId = row.envelope_id || null;
  try {
    const bytes = await verifiedFollowupBytes(row.source_path, row.source_sha256);
    let redirectUrl;
    if (row.kind === 'banking' && !envelopeId) {
      const accessToken = randomBytes(32).toString('base64url');
      const origin = process.env.HRS_ROA_PUBLIC_URL;
      if (!origin) throw new Error('public_url_not_configured');
      redirectUrl = `${new URL('/banking-proof', origin)}#${row.id}.${accessToken}`;
      row = await updateFollowup(id, { proof_access_hash: hashAccessToken(accessToken) });
    }
    if (!envelopeId) {
      try {
        envelopeId = await createFollowupEnvelope({ request: row, pdfBytes: bytes, redirectUrl });
      } catch (error) {
        if (error?.status && error.status < 500) throw error;
        const recovered = await findDocumensoEnvelopeByExternalId(id);
        if (!recovered?.id) {
          return res.status(503).json({ error: 'provider_send_ambiguous' });
        }
        envelopeId = recovered.id;
      }
    }
    const envelope = await getDocumensoEnvelope(envelopeId);
    // Persist the provider identity before field creation or distribution.
    row = await updateFollowup(id, {
      envelope_id: envelopeId, envelope_item_id: envelope?.envelopeItems?.[0]?.id,
    });
    if (String(envelope.status).toUpperCase() === 'DRAFT') {
      const itemId = await addFollowupFields({ envelopeId, request: row });
      row = await updateFollowup(id, { envelope_item_id: itemId });
      await distributeDocumensoEnvelope({ envelopeId,
        subject: `Please sign your ${row.kind === 'schedule' ? 'policy schedule' : 'Banking Details Confirmation'} — HRS Insurance`,
        message: 'Please review and sign your document.', brokerEmail: broker.brokerEmail,
        redirectUrl: row.kind === 'banking' ? envelope?.meta?.redirectUrl || redirectUrl : undefined,
      });
    }
    row = await updateFollowup(id, { status: 'pending', sent_at: new Date().toISOString() });
    row = await maybeSyncFollowupToCrm(row);
    return res.status(200).json({ request: publicFollowup(row) });
  } catch (error) {
    if (envelopeId) {
      // The envelope exists; keep its identity for a retry to resume the draft.
      console.error('followup send setup failed:', error?.status || 'provider_error');
      return res.status(502).json({ error: 'provider_setup_failed' });
    }
    if (error?.status && error.status < 500) {
      await updateFollowup(id, { status: 'failed' });
    }
    return res.status(502).json({ error: 'provider_send_failed' });
  }
}
