// POST /api/roa-submissions/sync-crm — broker-authenticated trigger.
// The browser supplies only the HRSROA submission id. Frozen client data and
// evidence bytes are loaded, verified, and sent by this server.
import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { CrmSyncError, syncSubmissionToCrm } from '../_lib/crmIntegration.js';
import { loadSubmissionForBroker } from '../_lib/submissionRepo.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { toClientView } from './get.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;
  const { submissionId } = req.body ?? {};
  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'Invalid submissionId' });
  const row = await loadSubmissionForBroker(submissionId, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  try {
    const updated = await syncSubmissionToCrm(row);
    return res.status(200).json({ ok: true, submission: toClientView(updated) });
  } catch (error) {
    const status = error instanceof CrmSyncError && error.status < 500 ? error.status : 502;
    return res.status(status).json({
      error: error instanceof CrmSyncError ? error.code : 'crm_sync_failed',
      submission: error?.row ? toClientView(error.row) : undefined,
    });
  }
}
