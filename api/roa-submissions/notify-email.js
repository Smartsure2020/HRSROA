// POST /api/roa-submissions/notify-email — send the broker notification email
// for a submission (Phase ROA-1 §12).
//
// The PDF attachment is loaded from Storage by submissionId and hash-verified
// server-side before being handed to Resend. The client never gets to
// re-upload arbitrary bytes after the canonical submission exists.
//
// The Personal / Commercial email body is built from the caller's payload
// (already privacy-hardened by src/lib/personalEmail.js for Personal).

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import {
  downloadPdf,
  loadSubmissionForBroker,
} from '../_lib/submissionRepo.js';
import { sha256HexOfBytes } from '../_lib/sha256.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { toClientView } from './get.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const { submissionId, to, subject, body } = req.body ?? {};
  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'Invalid submissionId' });
  if (typeof to !== 'string' || !to.includes('@')) return res.status(400).json({ error: 'Invalid to' });
  if (typeof subject !== 'string' || !subject) return res.status(400).json({ error: 'Missing subject' });
  if (typeof body !== 'string' || !body) return res.status(400).json({ error: 'Missing body' });

  const row = await loadSubmissionForBroker(submissionId, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  let pdfBytes;
  try {
    pdfBytes = await downloadPdf(row.pdf_storage_path);
  } catch (err) {
    console.error('notify-email: canonical download failed', err?.message);
    return res.status(500).json({ error: 'canonical_download_failed' });
  }
  if (sha256HexOfBytes(pdfBytes) !== row.pdf_sha256) {
    return res.status(500).json({ error: 'canonical_hash_mismatch' });
  }
  const pdfBase64 = pdfBytes.toString('base64');
  const pdfFilename = `${submissionId}-canonical.pdf`;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('\n📧 [DEV] Email send mocked (no RESEND_API_KEY configured)');
    console.log('  Submission:', submissionId);
    console.log('  To:', to);
    console.log('  Subject:', subject);
    console.log('  Attachment:', pdfFilename, `(${pdfBytes.length} bytes)`);
    return res.status(200).json({ ok: true, id: 'dev-mock', submission: toClientView(row) });
  }

  const payload = {
    from: 'HRS Insurance <info@hrsinsurance.co.za>',
    to: [to],
    subject,
    text: body,
    attachments: [{ filename: pdfFilename, content: pdfBase64 }],
  };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('notify-email: Resend error', data);
    return res.status(response.status).json({ error: data?.message || 'Failed to send email' });
  }
  return res.status(200).json({ ok: true, id: data.id, submission: toClientView(row) });
}
