// POST /api/send-for-signature — DEPRECATED (Phase ROA-1).
//
// Since ROA-1, remote signing envelopes are created by
// /api/roa-submissions/send-for-signature, which uses the canonical PDF
// canonical bytes stored server-side (idempotent on submissionId, hash-verified before
// each send). This endpoint is retained only long enough to give any
// straggling clients a clear 410 with the new route.

import { requireAuthenticatedBroker } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;
  return res.status(410).json({
    error: 'endpoint_deprecated',
    message: 'Use POST /api/roa-submissions/send-for-signature with { submissionId, signerName, signerEmail }.',
  });
}
