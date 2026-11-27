import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { loadSubmissionForBroker } from '../_lib/submissionRepo.js';
import { signerForSubmission } from '../roa-submissions/send-for-signature.js';
import { hasRequiredSigningEvidence } from '../_lib/signingLifecycle.js';
import { bankingConfirmationPdf, validSchedulePosition } from '../_lib/followupDocuments.js';
import {
  findFollowup, followupPath, insertFollowup, isRequestId,
  publicFollowup, storeFollowupPdf,
} from '../_lib/followupRepo.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { sha256HexOfBytes } from '../_lib/sha256.js';

export const config = { api: { bodyParser: { sizeLimit: '18mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const broker = await requireAuthenticatedBroker(req, res);
  if (!broker) return;
  const { id, submissionId, kind, pdfBase64, page, x, y } = req.body || {};
  if (!isRequestId(id) || !isSubmissionId(submissionId) || !['schedule', 'banking'].includes(kind)) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const submission = await loadSubmissionForBroker(submissionId, broker);
  if (!submission) return res.status(404).json({ error: 'not_found' });
  if (submission.status !== 'completed' || !hasRequiredSigningEvidence(submission)) {
    return res.status(409).json({ error: 'roa_not_signed' });
  }
  const signer = signerForSubmission(submission);
  if (!signer) return res.status(409).json({ error: 'signer_unavailable' });

  let bytes;
  let pageCount = 1;
  if (kind === 'schedule') {
    if (typeof pdfBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) {
      return res.status(400).json({ error: 'invalid_pdf' });
    }
    bytes = Buffer.from(pdfBase64, 'base64');
    if (bytes.length < 512 || bytes.length > 12 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-') {
      return res.status(400).json({ error: 'invalid_pdf' });
    }
    try {
      const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
      pageCount = pdf.numPages;
      await pdf.destroy();
    } catch { return res.status(400).json({ error: 'unreadable_pdf' }); }
    if (!validSchedulePosition({ page, x, y, pageCount })) {
      return res.status(400).json({ error: 'invalid_signature_position' });
    }
  } else {
    if (pdfBase64 != null || page != null || x != null || y != null) {
      return res.status(400).json({ error: 'banking_form_is_generated' });
    }
    bytes = bankingConfirmationPdf({ submissionId, signerName: signer.signerName });
  }

  const hash = sha256HexOfBytes(bytes);
  const existing = await findFollowup(id);
  if (existing) {
    if (existing.submission_id !== submissionId || existing.kind !== kind
      || existing.source_sha256 !== hash || existing.advisor_email.toLowerCase() !== broker.normalizedEmail) {
      return res.status(409).json({ error: 'request_id_conflict' });
    }
    return res.status(200).json({ request: publicFollowup(existing), repeated: true });
  }
  const sourcePath = followupPath(id, 'source.pdf');
  try {
    await storeFollowupPdf(sourcePath, bytes);
    const row = await insertFollowup({
      id, submission_id: submissionId, advisor_email: broker.normalizedEmail,
      kind, signer_name: signer.signerName, signer_email: signer.signerEmail,
      source_path: sourcePath, source_sha256: hash, source_size: bytes.length,
      signature_page: kind === 'schedule' ? page : null,
      signature_x: kind === 'schedule' ? x : null,
      signature_y: kind === 'schedule' ? y : null,
    });
    return res.status(201).json({ request: publicFollowup(row) });
  } catch (error) {
    const raced = await findFollowup(id).catch(() => null);
    if (raced) {
      if (raced.submission_id === submissionId && raced.kind === kind
        && raced.source_sha256 === hash && raced.advisor_email.toLowerCase() === broker.normalizedEmail) {
        return res.status(200).json({ request: publicFollowup(raced), repeated: true });
      }
      return res.status(409).json({ error: 'request_id_conflict' });
    }
    console.error('followup create failed:', error?.code || 'storage_or_database_error');
    return res.status(500).json({ error: 'followup_create_failed' });
  }
}
