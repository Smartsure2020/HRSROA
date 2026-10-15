// GET /api/roa-submissions/list — broker-owned submission register.
// Returns metadata only. The repository may read snapshot_json server-side to derive
// boolean availability flags, but snapshot_json is never returned to the browser.
// Branch previews use the same isolated staging services as the accepted polish preview.
//
// GET /api/roa-submissions/list?view=session — authorisation probe. Confirms the
// CRM-issued session belongs to an approved ROA broker and returns who that is,
// without touching the database. The SPA calls this right after sign-in so a
// valid CRM user who is NOT an approved broker gets a clear "not authorised"
// screen instead of a dashboard whose every action then fails with 403. It lives
// here rather than in its own file because the project is at the Vercel Hobby
// 12-function ceiling. It is a convenience only: every endpoint still enforces
// authorisation server-side.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { getAuthProjectConfig } from '../_lib/authConfig.js';
import { listSubmissionsForBroker } from '../_lib/submissionRepo.js';
import { toClientView } from './get.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  if (req.query?.view === 'session') {
    return res.status(200).json({
      ok: true,
      broker: { name: user.brokerName, email: user.brokerEmail },
      authSource: getAuthProjectConfig().source,
    });
  }

  try {
    const rows = await listSubmissionsForBroker(user);
    return res.status(200).json({
      ok: true,
      submissions: rows.map(toClientView),
    });
  } catch (err) {
    console.error('roa-submissions/list: failed', err?.message);
    return res.status(500).json({ error: 'list_failed' });
  }
}
