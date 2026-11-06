// Server-side repository for roa_submissions rows + storage objects
// (Phase ROA-1).
//
// All row ownership checks live here. Endpoints call these helpers instead of
// touching Supabase directly, so a missed ownership check cannot exist.
//
// This module talks to the ROA data project through the SERVICE ROLE, which
// bypasses RLS. Equivalent authorisation is therefore enforced in code: every
// read and write that is reachable from a broker request takes the authorised
// `broker` object produced by `requireAuthenticatedBroker` and is scoped to that
// broker's verified email (see ./brokerIdentity.js for why email, not the Auth
// user id, is the ownership key after the CRM-auth cutover).
//
// Reads are filtered in the query AND re-checked in code; single-row writes carry
// the same ownership filter, so a write can never touch another broker's row even
// if a caller forgot to load it first.
//
// Never log snapshot_json or banking fields.

import { StoragePaths, ROA_STORAGE_BUCKET, getServerSupabase } from './supabaseServer.js';
import { sha256HexOfBytes } from './sha256.js';
import { shouldReconcileSigningRecord } from './signingLifecycle.js';
import { ownerEmailPattern, ownsSubmission } from './brokerIdentity.js';

/**
 * Loads a submission row (any advisor).
 * @returns {Promise<object|null>}
 */
export async function loadSubmissionRaw(submissionId) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw new Error(`Load submission failed: ${error.message}`);
  return data || null;
}

/**
 * Loads a submission row and enforces broker ownership. Returns null if the
 * row does not exist OR the caller is not the advisor (safe 404 convention
 * that does not leak the existence of other brokers' submissions).
 *
 * @param {string} submissionId
 * @param {{ normalizedEmail: string }} broker — the authorised broker
 */
export async function loadSubmissionForBroker(submissionId, broker) {
  const row = await loadSubmissionRaw(submissionId);
  if (!row) return null;
  if (!ownsSubmission(row, broker)) return null;
  return row;
}

export async function listSubmissionsForBroker(broker) {
  const supabase = getServerSupabase();
  const columns = [
    'id', 'roa_type', 'client_reference', 'advisor_email', 'status', 'snapshot_json',
    'signing_provider', 'signing_envelope_id', 'signing_status', 'docusign_envelope_id', 'docusign_status',
    'submitted_at', 'sent_for_signature_at', 'completed_at', 'evidence_retrieved_at',
    'pdf_storage_path', 'signed_pdf_storage_path', 'certificate_storage_path',
    'audit_log_storage_path', 'signing_meta', 'crm_client_id', 'crm_deal_id',
    'crm_sync_status', 'crm_sync_error', 'crm_sync_attempted_at', 'crm_synced_at',
    'crm_signed_roa_document_id', 'crm_certificate_document_id', 'crm_audit_log_document_id',
    'revision_no', 'parent_submission_id', 'supersedes_submission_id',
    'superseded_by_submission_id', 'amendment_reason', 'amendment_reason_detail',
    'amended_by', 'amended_at',
  ].join(',');
  const { data, error } = await supabase
    .from('roa_submissions')
    .select(columns)
    .ilike('advisor_email', ownerEmailPattern(broker));
  if (error) throw new Error(`List submissions failed: ${error.message}`);
  return (data || [])
    .filter((row) => ownsSubmission(row, broker))
    .sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')))
    .slice(0, 250);
}

export async function listPendingSigningForBroker(broker, { limit = 25 } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 25, 1), 25);
  const supabase = getServerSupabase();
  const columns = [
    'id', 'advisor_user_id', 'advisor_email', 'status', 'submitted_at',
    'signing_provider', 'signing_envelope_id', 'signing_item_id', 'signing_status',
    'docusign_envelope_id', 'docusign_status',
    'completed_at', 'evidence_retrieved_at',
    'signed_pdf_storage_path', 'signed_pdf_sha256',
    'certificate_storage_path', 'certificate_sha256',
    'audit_log_storage_path', 'audit_log_sha256',
  ].join(',');
  const { data, error } = await supabase
    .from('roa_submissions')
    .select(columns)
    .ilike('advisor_email', ownerEmailPattern(broker));
  if (error) throw new Error(`List pending submissions failed: ${error.message}`);
  return (data || [])
    .filter((row) => ownsSubmission(row, broker))
    .filter(shouldReconcileSigningRecord)
    .sort((a, b) => String(a.submitted_at || '').localeCompare(String(b.submitted_at || '')))
    .slice(0, boundedLimit);
}

export async function insertSubmission(row) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .insert(row)
    .select('*')
    .single();
  if (error) throw new Error(`Insert submission failed: ${error.message}`);
  return data;
}

export async function updateSubmission(submissionId, patch) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update(patch)
    .eq('id', submissionId)
    .select('*')
    .single();
  if (error) throw new Error(`Update submission failed: ${error.message}`);
  return data;
}

// Lifecycle states in which a signing request may still be live (or was never sent). A row
// in any other state (completed, declined, voided, expired) is final as far as a provider
// OBSERVATION is concerned: a read taken a moment ago must never move it.
export const SUPERSEDABLE_STATUSES = Object.freeze(['awaiting_signature', 'submitted', 'signature_failed']);

/**
 * Records the first observed provider completion time without overwriting it. Only a row
 * that is still open (or already completed) can receive it, so a completion observed for a
 * row that was meanwhile voided or declined does not leave a contradictory timestamp.
 */
export async function setCompletionIfMissing(submissionId, broker, completedAt) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update({ completed_at: completedAt })
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker))
    .in('status', [...SUPERSEDABLE_STATUSES, 'completed'])
    .is('completed_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Set completion timestamp failed: ${error.message}`);
  return data;
}

/**
 * Writes what a provider READ said about a signing request, without ever acting on a stale
 * read. Broker-scoped and conditional on the row's CURRENT lifecycle:
 *
 *   - an observation that is not "completed" (pending, rejected, cancelled …) only applies
 *     while the row is still open AND has no completion time. If a signature completed in
 *     the meantime the write matches nothing, and the completed record is left exactly as it
 *     is (status, signing_status, completion time and evidence);
 *   - a "completed" observation may also be written to a row that is already completed, so
 *     evidence that failed to download the first time can still be filled in.
 *
 * Returns the updated row, or null when the row no longer matches (the caller re-reads it).
 */
export async function applyProviderObservation(submissionId, broker, patch, { completion = false } = {}) {
  const supabase = getServerSupabase();
  let query = supabase
    .from('roa_submissions')
    .update(patch)
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker));
  query = completion
    ? query.in('status', [...SUPERSEDABLE_STATUSES, 'completed'])
    : query.in('status', SUPERSEDABLE_STATUSES).is('completed_at', null);
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw new Error(`Apply provider observation failed: ${error.message}`);
  return data || null;
}

/**
 * Idempotent envelope reservation.
 * Atomically transitions status → 'awaiting_signature' iff no envelope is
 * already recorded and status is currently 'submitted' or 'signature_failed'.
 * Returns { reserved, row } — when `reserved` is false, `row` contains the
 * current state (which will already carry an envelope_id or be in a
 * terminal state).
 */
export async function reserveEnvelopeSlot(submissionId, broker) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update({ status: 'awaiting_signature', sent_for_signature_at: new Date().toISOString() })
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker))
    .is('docusign_envelope_id', null)
    .in('status', ['submitted', 'signature_failed'])
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Reserve envelope slot failed: ${error.message}`);
  if (data) return { reserved: true, row: data };
  const current = await loadSubmissionForBroker(submissionId, broker);
  return { reserved: false, row: current };
}

/** Rolls a reservation back so the broker can retry after a definite failure. */
export async function releaseEnvelopeReservation(submissionId, broker, { reason } = {}) {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from('roa_submissions')
    .update({
      status: 'signature_failed',
      sent_for_signature_at: null,
      docusign_status: reason ? `failed: ${reason}`.slice(0, 200) : 'failed',
    })
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker))
    .eq('status', 'awaiting_signature')
    .is('docusign_envelope_id', null);
  if (error) throw new Error(`Release envelope reservation failed: ${error.message}`);
}


/**
 * Provider-neutral signing reservation used by new signing integrations.
 */
export async function reserveSigningSlot(submissionId, broker, provider) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update({
      status: 'awaiting_signature',
      sent_for_signature_at: new Date().toISOString(),
      signing_provider: provider,
    })
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker))
    .is('signing_envelope_id', null)
    .in('status', ['submitted', 'signature_failed'])
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Reserve signing slot failed: ${error.message}`);
  if (data) return { reserved: true, row: data };
  const current = await loadSubmissionForBroker(submissionId, broker);
  return { reserved: false, row: current };
}

export async function releaseSigningReservation(submissionId, broker, provider, { reason } = {}) {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from('roa_submissions')
    .update({
      status: 'signature_failed',
      sent_for_signature_at: null,
      signing_status: reason ? `failed: ${reason}`.slice(0, 200) : 'failed',
    })
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker))
    .eq('signing_provider', provider)
    .eq('status', 'awaiting_signature')
    .is('signing_envelope_id', null);
  if (error) throw new Error(`Release signing reservation failed: ${error.message}`);
}

// ---------- Amendments (Issue #8) --------------------------------------------

export class RevisionCreateError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'RevisionCreateError';
    this.code = code;
    this.status = status;
  }
}

// SQLSTATEs raised by public.roa_create_revision / the revision guard triggers
// (supabase/migrations/20261029_roa_amendments.sql).
const REVISION_SQLSTATES = {
  RA001: ['predecessor_not_found', 404],
  RA002: ['predecessor_not_found', 404], // another broker's row: indistinguishable from "missing"
  RA003: ['roa_type_mismatch', 409],
  RA004: ['revision_conflict', 409],
  RA005: ['revision_conflict', 409],
  RA006: ['already_superseded', 409],
  RA007: ['submission_conflict', 409],
  RA008: ['revision_conflict', 409],
  '23505': ['revision_conflict', 409], // unique successor / unique revision number
};

function revisionErrorFrom(error) {
  const code = String(error?.code || '');
  const mapped = REVISION_SQLSTATES[code];
  if (mapped) return new RevisionCreateError(mapped[0], mapped[1]);
  // Fall back to the stable message token if the code was not surfaced.
  const token = String(error?.message || '').match(/roa_revision_[a-z_]+/)?.[0];
  const byToken = {
    roa_revision_predecessor_not_found: REVISION_SQLSTATES.RA001,
    roa_revision_owner_mismatch: REVISION_SQLSTATES.RA002,
    roa_revision_type_mismatch: REVISION_SQLSTATES.RA003,
    roa_revision_already_superseded: REVISION_SQLSTATES.RA006,
    roa_revision_id_conflict: REVISION_SQLSTATES.RA007,
  }[token];
  if (byToken) return new RevisionCreateError(byToken[0], byToken[1]);
  return new RevisionCreateError('revision_create_failed', 500);
}

/**
 * Creates the next revision in ONE database transaction (roa_create_revision): the
 * predecessor is locked, verified to be the head of the chain and owned by `broker`,
 * the new row is inserted and the predecessor's forward link is written. A retry with
 * the same `submissionId` and identical content returns the existing row, so a lost
 * response or a partial failure on the caller's side is always safe to repeat.
 *
 * Nothing about the predecessor changes except its write-once forward link.
 */
export async function createRevision({
  submissionId,
  supersedesId,
  broker,
  roaType,
  clientReference,
  snapshot,
  versions,
  pdf,
  reason,
  reasonDetail,
}) {
  ownerEmailPattern(broker); // throws for an unusable identity, never degrades to unscoped
  const supabase = getServerSupabase();
  const { data, error } = await supabase.rpc('roa_create_revision', {
    p_new_id: submissionId,
    p_supersedes_id: supersedesId,
    p_owner_email: broker.normalizedEmail,
    p_advisor_user_id: broker.id,
    p_roa_type: roaType,
    p_client_reference: clientReference,
    p_snapshot: snapshot,
    p_template_version: versions.templateVersion,
    p_statutory_disclosure_version: versions.statutoryDisclosureVersion,
    p_broker_appointment_version: versions.brokerAppointmentVersion,
    p_broker_fee_version: versions.brokerFeeVersion,
    p_letter_investigation_version: versions.letterInvestigationVersion || null,
    p_pdf_sha256: pdf.sha256,
    p_pdf_storage_path: pdf.path,
    p_pdf_byte_length: pdf.byteLength,
    p_amendment_reason: reason,
    p_amendment_reason_detail: reasonDetail || null,
    p_amended_by: broker.normalizedEmail,
  });
  if (error) throw revisionErrorFrom(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) throw new RevisionCreateError('revision_create_failed', 500);
  return row;
}

/**
 * Persists a step of the cancellation state machine (intent, evidence backup progress,
 * delete dispatch / acknowledgement, manual-resolution flag) in `signing_meta.supersession`.
 * Broker-scoped and conditional on the row still being open with no completion time, so a
 * stale writer cannot touch a row that completed meanwhile. Null if the row moved on.
 */
export async function recordSupersessionState(submissionId, broker, signingMeta) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update({ signing_meta: signingMeta })
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker))
    .in('status', SUPERSEDABLE_STATUSES)
    .is('completed_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Record supersession state failed: ${error.message}`);
  return data || null;
}

/**
 * Marks a superseded request as voided once the provider has verifiably cancelled it.
 * Compare-and-swap on status + completed_at (and on the forward link, so only the revision
 * that actually replaces this one can void it): returns null, changing nothing, if the row
 * completed or otherwise changed in the meantime.
 */
export async function markSupersededVoided(submissionId, broker, signingMeta, replacementId) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update({ status: 'voided', signing_status: 'cancelled', signing_meta: signingMeta })
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker))
    .eq('superseded_by_submission_id', replacementId)
    .in('status', SUPERSEDABLE_STATUSES)
    .is('completed_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Mark superseded request voided failed: ${error.message}`);
  return data || null;
}

/**
 * Records an envelope that was created at the provider but never written back (a lost
 * response). Conditional on the reservation still being the one we are recovering, so it
 * cannot overwrite a row that completed, was cancelled or already received an envelope.
 */
export async function adoptRecoveredEnvelope(submissionId, broker, patch) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update(patch)
    .eq('id', submissionId)
    .ilike('advisor_email', ownerEmailPattern(broker))
    .eq('status', 'awaiting_signature')
    .eq('signing_provider', 'documenso')
    .is('signing_envelope_id', null)
    .is('completed_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Adopt recovered envelope failed: ${error.message}`);
  return data || null;
}

// ---------- Storage ---------------------------------------------------------

export async function uploadPdf(path, bytes, { contentType = 'application/pdf' } = {}) {
  const supabase = getServerSupabase();
  const { error } = await supabase.storage.from(ROA_STORAGE_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`Storage upload ${path} failed: ${error.message}`);
}

export async function downloadPdf(path) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.storage.from(ROA_STORAGE_BUCKET).download(path);
  if (error) throw new Error(`Storage download ${path} failed: ${error.message}`);
  if (!data) throw new Error(`Storage download ${path} returned no data`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Stores deterministic evidence without overwriting. If Storage already
 * contains the expected bytes (for example after a DB metadata failure),
 * treat that object as already successful. Conflicting bytes fail closed.
 */
export async function ensurePdfStored(
  path,
  bytes,
  { contentType = 'application/pdf', expectedSha256 } = {},
) {
  const expectedHash = expectedSha256 || sha256HexOfBytes(bytes);

  try {
    await uploadPdf(path, bytes, { contentType });
    return { alreadyPresent: false, sha256: expectedHash };
  } catch (uploadError) {
    let existingBytes;
    try {
      existingBytes = await downloadPdf(path);
    } catch {
      throw uploadError;
    }

    const existingHash = sha256HexOfBytes(existingBytes);
    if (existingHash !== expectedHash) {
      const conflict = new Error(`Storage object conflict at ${path}`);
      conflict.code = 'storage_object_conflict';
      conflict.expectedSha256 = expectedHash;
      conflict.actualSha256 = existingHash;
      throw conflict;
    }

    return { alreadyPresent: true, sha256: expectedHash };
  }
}

export { StoragePaths };
