// POST /api/send-for-signature — DEPRECATED (Phase ROA-1).
//
// Since ROA-1, DocuSign envelopes are created by
// /api/roa-submissions/send-for-signature, which uses the canonical PDF
// bytes stored server-side (idempotent on submissionId, hash-verified before
// each send). This endpoint is retained only long enough to give any
// straggling clients a clear 410 with the new route.

import { requireAuthenticatedBroker } from './_lib/auth.js';

export const config = { api: { bodyParser: { sizeLimit: '18mb' } } };

export default async function handler(req, res) {
  const followupOperation = String(req.query?.operation || '');
  const followupHandlers = {
    'followup-create': () => import('./_followups/create.js'),
    'followup-send': () => import('./_followups/send.js'),
    'followup-list': () => import('./_followups/list.js'),
    'followup-refresh': () => import('./_followups/refresh.js'),
    'followup-remind': () => import('./_followups/remind.js'),
    'followup-download': () => import('./_followups/download.js'),
    'followup-sync-crm': () => import('./_followups/sync-crm.js'),
  };
  if (Object.prototype.hasOwnProperty.call(followupHandlers, followupOperation)) {
    return (await followupHandlers[followupOperation]()).default(req, res);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;
  return res.status(410).json({
    error: 'endpoint_deprecated',
    message: 'Use POST /api/roa-submissions/send-for-signature with { submissionId, signerName, signerEmail }.',
  });
}
