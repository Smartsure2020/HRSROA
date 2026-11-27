import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { getDocumensoEnvelope, redistributeDocumensoEnvelope } from '../_lib/documensoClient.js';
import { isRequestId, ownedFollowup, publicFollowup, updateFollowup } from '../_lib/followupRepo.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const broker = await requireAuthenticatedBroker(req, res);
  if (!broker) return;
  const id = req.body?.id;
  if (!isRequestId(id)) return res.status(400).json({ error: 'invalid_request_id' });
  const owned = await ownedFollowup(id, broker);
  if (!owned) return res.status(404).json({ error: 'not_found' });
  const row = owned.request;
  if (row.status !== 'pending' || !row.envelope_id) return res.status(409).json({ error: 'not_pending' });
  if (row.last_reminder_at && Date.now() - Date.parse(row.last_reminder_at) < 24 * 3600_000) {
    return res.status(429).json({ error: 'reminder_too_soon' });
  }
  try {
    const envelope = await getDocumensoEnvelope(row.envelope_id);
    if (String(envelope.status).toUpperCase() !== 'PENDING') return res.status(409).json({ error: 'not_pending' });
    const recipient = envelope.recipients?.find(item => item.email?.toLowerCase() === row.signer_email.toLowerCase());
    if (!recipient?.id || String(recipient.signingStatus).toUpperCase() === 'SIGNED') {
      return res.status(409).json({ error: 'signer_already_actioned' });
    }
    await redistributeDocumensoEnvelope({ envelopeId: row.envelope_id, recipientIds: [recipient.id] });
    const updated = await updateFollowup(id, { last_reminder_at: new Date().toISOString() });
    return res.status(200).json({ request: publicFollowup(updated) });
  } catch { return res.status(502).json({ error: 'reminder_failed' }); }
}
