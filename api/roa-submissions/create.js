// POST /api/roa-submissions/create — freeze a submission (Phase ROA-1).
//
// Contract (see ROA-1 spec §11):
//   1. Authenticate the caller (must be an HRS broker).
//   2. Client has already: validated the wizard, applied conditional cleanup,
//      deep-cloned the frozen snapshot, and generated the canonical PDF once.
//      This endpoint refuses to regenerate the PDF; it treats the bytes it
//      receives as canonical.
//   3. Server computes SHA-256 of the raw PDF bytes (never of the base64
//      string) and persists it alongside snapshot_json + compliance versions.
//   4. Server uploads the exact bytes to Storage at
//      `roa-pdfs/<submissionId>/canonical.pdf`.
//   5. Returns { submissionId, pdfSha256, ... } — the client uses these ids
//      for every downstream action (download, email, DocuSign).
//
// Non-goals here:
//   • The endpoint does NOT send email or a DocuSign envelope.
//   • The endpoint does NOT accept an existing submissionId (call is
//     insert-only; the id is authoritative per submission).

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { base64ToBytes, sha256HexOfBytes } from '../_lib/sha256.js';
import { insertSubmission, uploadPdf, StoragePaths } from '../_lib/submissionRepo.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';

const ROA_TYPES = ['Personal', 'Commercial'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clientReferenceFor(roaType, snapshot) {
  if (roaType === 'Personal') {
    const parts = [snapshot?.firstName, snapshot?.surname].filter(Boolean).join(' ').trim();
    return parts ? `Personal – ${parts}` : 'Personal – (unnamed)';
  }
  const co = String(snapshot?.companyName || '').trim();
  return co ? `Commercial – ${co}` : 'Commercial – (unnamed)';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const {
    submissionId,
    roaType,
    snapshot,
    versions,
    pdfBase64,
  } = req.body ?? {};

  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'Invalid submissionId' });
  if (!ROA_TYPES.includes(roaType)) return res.status(400).json({ error: 'Invalid roaType' });
  if (!isPlainObject(snapshot)) return res.status(400).json({ error: 'Invalid snapshot' });
  if (!isPlainObject(versions)) return res.status(400).json({ error: 'Invalid versions' });
  if (typeof pdfBase64 !== 'string' || pdfBase64.length === 0) {
    return res.status(400).json({ error: 'Invalid pdfBase64' });
  }

  const requiredVersionKeys = [
    'templateVersion',
    'statutoryDisclosureVersion',
    'brokerAppointmentVersion',
    'brokerFeeVersion',
  ];
  for (const k of requiredVersionKeys) {
    if (typeof versions[k] !== 'string' || versions[k].length === 0) {
      return res.status(400).json({ error: `Missing versions.${k}` });
    }
  }

  let bytes;
  try {
    bytes = base64ToBytes(pdfBase64);
  } catch {
    return res.status(400).json({ error: 'pdfBase64 could not be decoded' });
  }
  if (bytes.length < 512) {
    return res.status(400).json({ error: 'Canonical PDF is impossibly small' });
  }
  const pdfSha256 = sha256HexOfBytes(bytes);
  const canonicalPath = StoragePaths.canonical(submissionId);

  // Upload FIRST — if this fails, we do not want a row without evidence.
  try {
    await uploadPdf(canonicalPath, bytes);
  } catch (err) {
    console.error('roa-submissions/create: storage upload failed', err?.message);
    return res.status(500).json({ error: 'storage_upload_failed' });
  }

  const nowIso = new Date().toISOString();
  const row = {
    id: submissionId,
    roa_type: roaType,
    status: 'submitted',
    advisor_user_id: user.id,
    advisor_email: user.email,
    client_reference: clientReferenceFor(roaType, snapshot),
    snapshot_json: snapshot,
    template_version: versions.templateVersion,
    statutory_disclosure_version: versions.statutoryDisclosureVersion,
    broker_appointment_version: versions.brokerAppointmentVersion,
    broker_fee_version: versions.brokerFeeVersion,
    letter_investigation_version: versions.letterInvestigationVersion || null,
    pdf_sha256: pdfSha256,
    pdf_storage_path: canonicalPath,
    pdf_byte_length: bytes.length,
    submitted_at: nowIso,
  };

  try {
    const persisted = await insertSubmission(row);
    return res.status(200).json({
      ok: true,
      submissionId: persisted.id,
      pdfSha256: persisted.pdf_sha256,
      status: persisted.status,
      roaType: persisted.roa_type,
      submittedAt: persisted.submitted_at,
      pdfByteLength: persisted.pdf_byte_length,
    });
  } catch (err) {
    console.error('roa-submissions/create: insert failed', err?.message);
    return res.status(500).json({ error: 'persist_failed' });
  }
}
