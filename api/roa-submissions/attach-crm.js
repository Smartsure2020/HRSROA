// POST /api/roa-submissions/attach-crm — persist CRM ids on the submission.
//
// Called by the client after a successful crmSync from the Checklist screen.
// ROA lifecycle is deliberately independent of CRM state — a failed sync
// does not prevent evidence retention or DocuSign; a successful sync merely
// records the ids so the two systems can be reconciled later.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { loadSubmissionForBroker, updateSubmission } from '../_lib/submissionRepo.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { toClientView } from './get.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const { submissionId, crmClientId, crmDealId } = req.body ?? {};
  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'Invalid submissionId' });

  const row = await loadSubmissionForBroker(submissionId, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const patch = {};
  if (typeof crmClientId === 'string' && crmClientId.length > 0) patch.crm_client_id = crmClientId;
  if (typeof crmDealId === 'string' && crmDealId.length > 0) patch.crm_deal_id = crmDealId;
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'no_crm_ids_provided' });
  }

  const updated = await updateSubmission(submissionId, patch);
  return res.status(200).json({ ok: true, submission: toClientView(updated) });
}
