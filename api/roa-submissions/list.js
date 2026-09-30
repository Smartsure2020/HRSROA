// GET /api/roa-submissions/list — broker-owned submission register.
// Returns metadata only. snapshot_json is deliberately absent from both the
// query and response so a register view cannot expose frozen client data.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { listSubmissionsForBroker } from '../_lib/submissionRepo.js';
import { toClientView } from './get.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  try {
    const rows = await listSubmissionsForBroker(user.id);
    return res.status(200).json({
      ok: true,
      submissions: rows.map(toClientView),
    });
  } catch (err) {
    console.error('roa-submissions/list: failed', err?.message);
    return res.status(500).json({ error: 'list_failed' });
  }
}
