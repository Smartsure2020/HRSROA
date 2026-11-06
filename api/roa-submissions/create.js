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
// Amendments (Issue #8): the same call with an `amendment` object —
//   { supersedesSubmissionId, reason, reasonDetail? }
// creates the NEXT revision of an existing, owned submission instead of an independent one.
// The revision number, chain root, `amended_by` and timestamps are derived on the server
// (the browser can supply none of them), the predecessor must be the un-superseded head of
// its chain, and the whole link is written by one database transaction. The predecessor's
// snapshot, canonical PDF, signed evidence and status are never touched.
//
// Non-goals here:
//   • The endpoint does NOT send email or a DocuSign envelope.
//   • The endpoint does NOT accept an existing submissionId for a different payload (call
//     is insert-only; the id is authoritative per submission).
//   • The endpoint does NOT cancel the predecessor's signing request — that happens only
//     when the replacement is sent (see ../_lib/supersession.js).

import { isDeepStrictEqual } from 'node:util';
import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { base64ToBytes, sha256HexOfBytes } from '../_lib/sha256.js';
import {
  createRevision,
  ensurePdfStored,
  insertSubmission,
  loadSubmissionForBroker,
  RevisionCreateError,
  StoragePaths,
} from '../_lib/submissionRepo.js';
import { ownsSubmission } from '../_lib/brokerIdentity.js';
import { hasSigningEnvelope, signingProviderFor } from '../_lib/signingLifecycle.js';
import { isSubmissionId } from '../../src/lib/roaSubmissionSnapshot.js';
import { amendmentBlockReason, validateAmendmentReason } from '../../src/lib/roaAmendment.js';

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

function createdResponse(row, extra = {}) {
  return {
    ok: true,
    ...extra,
    submissionId: row.id,
    pdfSha256: row.pdf_sha256,
    status: row.status,
    roaType: row.roa_type,
    submittedAt: row.submitted_at,
    pdfByteLength: row.pdf_byte_length,
  };
}

/**
 * Amendment path. Returns the HTTP response; never inserts a standalone row.
 */
async function createAmendment({ res, user, amend, submissionId, roaType, snapshot, versions, bytes, pdfSha256, canonicalPath }) {
  const predecessor = await loadSubmissionForBroker(amend.supersedesId, user);
  if (!predecessor) return res.status(404).json({ error: 'predecessor_not_found' });
  if (predecessor.roa_type !== roaType) return res.status(409).json({ error: 'roa_type_mismatch' });

  // A retry of a revision that already committed finds its own row here. In that case the
  // predecessor is (correctly) already superseded — by this very revision — so the
  // head-of-chain pre-check is skipped and the transaction reconciles it.
  let existing = null;
  try {
    existing = await loadSubmissionForBroker(submissionId, user);
  } catch (err) {
    console.error('roa-submissions/create: amendment reconciliation read failed', err?.message);
    return res.status(500).json({ error: 'persist_failed' });
  }
  if (!existing) {
    const blocked = amendmentBlockReason({
      status: predecessor.status,
      supersededBySubmissionId: predecessor.superseded_by_submission_id,
      hasEnvelope: hasSigningEnvelope(predecessor),
      signingProvider: signingProviderFor(predecessor),
    });
    if (blocked) return res.status(409).json({ error: blocked });
  }

  try {
    await ensurePdfStored(canonicalPath, bytes, { expectedSha256: pdfSha256 });
  } catch (err) {
    console.error('roa-submissions/create: storage reconciliation failed', err?.message);
    if (err?.code === 'storage_object_conflict') {
      return res.status(409).json({ error: 'canonical_storage_conflict' });
    }
    return res.status(500).json({ error: 'storage_upload_failed' });
  }

  try {
    const row = await createRevision({
      submissionId,
      supersedesId: amend.supersedesId,
      broker: user,
      roaType,
      clientReference: clientReferenceFor(roaType, snapshot),
      snapshot,
      versions,
      pdf: { sha256: pdfSha256, path: canonicalPath, byteLength: bytes.length },
      reason: amend.reason,
      reasonDetail: amend.reasonDetail,
    });
    return res.status(200).json(createdResponse(row, {
      reconciled: existing ? true : undefined,
      revisionNo: row.revision_no,
      supersedesSubmissionId: row.supersedes_submission_id,
      parentSubmissionId: row.parent_submission_id,
    }));
  } catch (err) {
    if (err instanceof RevisionCreateError) {
      return res.status(err.status).json({ error: err.code });
    }
    console.error('roa-submissions/create: revision transaction failed', err?.message);
    return res.status(500).json({ error: 'persist_failed' });
  }
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
    amendment,
  } = req.body ?? {};

  if (!isSubmissionId(submissionId)) return res.status(400).json({ error: 'Invalid submissionId' });
  if (!ROA_TYPES.includes(roaType)) return res.status(400).json({ error: 'Invalid roaType' });
  if (!isPlainObject(snapshot)) return res.status(400).json({ error: 'Invalid snapshot' });
  if (!isPlainObject(versions)) return res.status(400).json({ error: 'Invalid versions' });
  if (typeof pdfBase64 !== 'string' || pdfBase64.length === 0) {
    return res.status(400).json({ error: 'Invalid pdfBase64' });
  }

  // Revision metadata is validated here and DERIVED on the server; the request carries only
  // which revision to replace and why. Anything else in `amendment` is ignored.
  let amend = null;
  if (amendment !== undefined && amendment !== null) {
    if (!isPlainObject(amendment)) return res.status(400).json({ error: 'Invalid amendment' });
    if (!isSubmissionId(amendment.supersedesSubmissionId)) {
      return res.status(400).json({ error: 'Invalid supersedesSubmissionId' });
    }
    if (amendment.supersedesSubmissionId === submissionId) {
      return res.status(400).json({ error: 'Invalid supersedesSubmissionId' });
    }
    const reason = validateAmendmentReason({
      reason: amendment.reason,
      reasonDetail: amendment.reasonDetail,
    });
    if (!reason.ok) return res.status(400).json({ error: reason.error });
    amend = {
      supersedesId: amendment.supersedesSubmissionId,
      reason: reason.reason,
      reasonDetail: reason.reasonDetail,
    };
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

  if (amend) {
    return createAmendment({
      res, user, amend, submissionId, roaType, snapshot, versions, bytes, pdfSha256, canonicalPath,
    });
  }

  // Upload FIRST, but reconcile a deterministic object from a prior partial
  // failure. Identical bytes are safe; conflicting bytes fail closed.
  try {
    await ensurePdfStored(canonicalPath, bytes, { expectedSha256: pdfSha256 });
  } catch (err) {
    console.error('roa-submissions/create: storage reconciliation failed', err?.message);
    if (err?.code === 'storage_object_conflict') {
      return res.status(409).json({ error: 'canonical_storage_conflict' });
    }
    return res.status(500).json({ error: 'storage_upload_failed' });
  }

  const nowIso = new Date().toISOString();
  const row = {
    id: submissionId,
    roa_type: roaType,
    status: 'submitted',
    // advisor_user_id is the CRM Auth user id. Ownership of this and every historic
    // row is decided by the verified advisor_email (see _lib/brokerIdentity.js).
    advisor_user_id: user.id,
    advisor_email: user.normalizedEmail,
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
    // A retry can arrive after the DB write actually committed but its response
    // was lost. Only reconcile when every canonical identity field still
    // matches; otherwise the reused submission id fails closed.
    let existing = null;
    try {
      existing = await loadSubmissionForBroker(submissionId, user);
    } catch (reconcileErr) {
      console.error('roa-submissions/create: DB reconciliation failed', reconcileErr?.message);
    }

    if (existing) {
      const sameSubmission =
        existing.roa_type === roaType
        && ownsSubmission(existing, user)
        && existing.pdf_sha256 === pdfSha256
        && existing.pdf_storage_path === canonicalPath
        && existing.pdf_byte_length === bytes.length
        && existing.template_version === versions.templateVersion
        && existing.statutory_disclosure_version === versions.statutoryDisclosureVersion
        && existing.broker_appointment_version === versions.brokerAppointmentVersion
        && existing.broker_fee_version === versions.brokerFeeVersion
        && (existing.letter_investigation_version || null) === (versions.letterInvestigationVersion || null)
        && isDeepStrictEqual(existing.snapshot_json, snapshot);

      if (sameSubmission) {
        return res.status(200).json({
          ok: true,
          reconciled: true,
          submissionId: existing.id,
          pdfSha256: existing.pdf_sha256,
          status: existing.status,
          roaType: existing.roa_type,
          submittedAt: existing.submitted_at,
          pdfByteLength: existing.pdf_byte_length,
        });
      }

      return res.status(409).json({ error: 'submission_conflict' });
    }

    console.error('roa-submissions/create: insert failed', err?.message);
    return res.status(500).json({ error: 'persist_failed' });
  }
}
