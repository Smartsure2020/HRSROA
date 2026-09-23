// GET /api/roa-submissions/pdf?id=ROA-<uuid>&kind=canonical|signed|certificate|audit
//
// Downloads one of the stored evidence artefacts for the submission. Broker-
// scoped (404 for non-owner, same as get.js). Never streams from a browser-
// supplied path — the storage path is chosen by the server based on the
// requested `kind`.
//
// Contract:
//   • canonical    → StoragePaths.canonical(id); must always exist for any
//                    non-terminal submission.
//   • signed       → final completed signing-provider PDF; 409 if unavailable.
//   • certificate  → signing certificate PDF; same 409 semantics.
//   • audit        → signing audit-log PDF; same 409 semantics.

import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { downloadPdf, loadSubmissionForBroker, StoragePaths } from '../_lib/submissionRepo.js';
import { sha256HexOfBytes } from '../_lib/sha256.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';

const KINDS = ['canonical', 'signed', 'certificate', 'audit'];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireAuthenticatedBroker(req, res);
  if (!user) return;

  const id = String(req.query?.id ?? '');
  const kind = String(req.query?.kind ?? 'canonical');
  if (!isSubmissionId(id)) return res.status(400).json({ error: 'Invalid submissionId' });
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid kind' });

  const row = await loadSubmissionForBroker(id, user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  let storagePath;
  let expectedHash = null;
  if (kind === 'canonical') {
    storagePath = row.pdf_storage_path || StoragePaths.canonical(id);
    expectedHash = row.pdf_sha256;
  } else if (kind === 'signed') {
    storagePath = row.signed_pdf_storage_path;
    expectedHash = row.signed_pdf_sha256;
    if (!storagePath) return res.status(409).json({ error: 'signed_not_available' });
  } else if (kind === 'certificate') {
    storagePath = row.certificate_storage_path;
    expectedHash = row.certificate_sha256;
    if (!storagePath) return res.status(409).json({ error: 'certificate_not_available' });
  } else {
    storagePath = row.audit_log_storage_path;
    expectedHash = row.audit_log_sha256;
    if (!storagePath) return res.status(409).json({ error: 'audit_not_available' });
  }

  let bytes;
  try {
    bytes = await downloadPdf(storagePath);
  } catch (err) {
    console.error('roa-submissions/pdf: download failed', err?.message);
    return res.status(500).json({ error: 'storage_download_failed' });
  }

  // Defence-in-depth: verify the stored bytes still match the recorded hash
  // before serving them. Prevents a silently corrupted / replaced object
  // from being served as authoritative.
  if (expectedHash) {
    const actual = sha256HexOfBytes(bytes);
    if (actual !== expectedHash) {
      console.error(`roa-submissions/pdf: hash mismatch for ${id}/${kind}`);
      return res.status(500).json({ error: 'evidence_hash_mismatch' });
    }
  }

  const filename = `${id}-${kind}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(bytes);
}
