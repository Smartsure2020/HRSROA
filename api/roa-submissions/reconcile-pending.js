import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { listPendingSigningForBroker } from '../_lib/submissionRepo.js';
import { reconcileSigningSubmission } from '../_lib/signingReconciliation.js';
import { toClientView } from './get.js';

const BATCH_SIZE = 25;
const CONCURRENCY = 3;

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  try {
    const rows = await listPendingSigningForBroker(user.id, { limit: BATCH_SIZE });
    const results = await mapWithConcurrency(rows, CONCURRENCY, async (row) => {
      try {
        const result = await reconcileSigningSubmission({
          submissionId: row.id,
          row,
          brokerUserId: user.id,
        });
        return {
          submissionId: row.id,
          ok: true,
          refreshed: result.refreshed,
          observedStatus: result.observedStatus,
          submission: toClientView(result.row),
          evidenceErrors: result.evidenceErrors?.length ? result.evidenceErrors : undefined,
        };
      } catch (err) {
        console.error('reconcile-pending: submission failed', row.id, err?.message);
        return { submissionId: row.id, ok: false, error: err?.message || 'reconciliation_failed' };
      }
    });
    return res.status(200).json({
      ok: true,
      attempted: rows.length,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    });
  } catch (err) {
    console.error('reconcile-pending: failed', err?.message);
    return res.status(500).json({ error: 'reconcile_pending_failed' });
  }
}
