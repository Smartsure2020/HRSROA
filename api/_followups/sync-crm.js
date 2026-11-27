import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { isRequestId, ownedFollowup, publicFollowup } from '../_lib/followupRepo.js';
import { syncFollowupToCrm } from '../_lib/followupCrm.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const broker = await requireAuthenticatedBroker(req, res);
  if (!broker) return;
  const id = req.body?.id;
  if (!isRequestId(id)) return res.status(400).json({ error: 'invalid_request_id' });
  const owned = await ownedFollowup(id, broker);
  if (!owned) return res.status(404).json({ error: 'not_found' });
  if (!['pending', 'completed', 'declined'].includes(owned.request.status)) {
    return res.status(409).json({ error: 'request_not_sent' });
  }
  try { return res.status(200).json({ request: publicFollowup(await syncFollowupToCrm(owned.request)) }); }
  catch (error) { return res.status(502).json({ error: error?.message || 'crm_sync_failed' }); }
}
