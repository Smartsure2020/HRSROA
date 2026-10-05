// POST /api/roa-submissions/send-reminder — re-send the signing email for an EXISTING
// Documenso envelope (Documenso v2 `POST /envelope/redistribute`).
//
// Deliberately separate from send-for-signature: this never creates an envelope, never
// reserves a signing slot and never changes the submission lifecycle status. It is
// broker-scoped (404 for non-owners), only available while the client can still sign, and
// rate-limited per submission.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { loadSubmissionForBroker } from '../_lib/submissionRepo.js';
import { sendReminderViaDocumenso } from '../_lib/documensoSigning.js';
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
    const result = await sendReminderViaDocumenso({ submissionId, row });
    return res.status(200).json({
      ok: true,
      provider: 'documenso',
      reminderSentAt: result.reminderSentAt,
      submission: toClientView(result.row),
    });
  } catch (err) {
    const status = Number.isFinite(err?.status) ? err.status : 500;
    if (status >= 500) console.error('send-reminder: failed', err?.message);
    return res.status(status).json({
      error: status >= 500 && !err?.message ? 'reminder_failed' : err.message,
      retryAfterSeconds: err?.retryAfterSeconds,
      submission: toClientView(row),
    });
  }
}
