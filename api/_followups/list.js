import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { listFollowups, publicFollowup } from '../_lib/followupRepo.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const broker = await requireAuthenticatedBroker(req, res);
  if (!broker) return;
  const submissionId = String(req.query?.submissionId || '');
  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'invalid_submission_id' });
  const rows = await listFollowups(submissionId, broker);
  if (!rows) return res.status(404).json({ error: 'not_found' });
  return res.status(200).json({ requests: rows.map(publicFollowup) });
}
