// POST /api/roa-submissions/refresh — owner-scoped reconciliation for one
// submission. Provider polling and evidence retention live in the shared
// signingReconciliation service used by both this endpoint and the register.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { loadSubmissionForBroker } from '../_lib/submissionRepo.js';
import { reconcileSigningSubmission } from '../_lib/signingReconciliation.js';
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
    const result = await reconcileSigningSubmission({ submissionId, row, brokerUserId: user.id });
    return res.status(200).json({
      ok: true,
      provider: result.provider,
      submission: toClientView(result.row),
      refreshed: result.refreshed,
      observedStatus: result.observedStatus,
      evidenceErrors: result.evidenceErrors?.length ? result.evidenceErrors : undefined,
      message: result.message,
    });
  } catch (err) {
    console.error('refresh: signing reconciliation failed', err?.message);
    return res.status(err?.status || 500).json({ error: err?.message || 'signing_refresh_failed' });
  }
}
