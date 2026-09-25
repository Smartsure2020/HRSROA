// Server-side repository for roa_submissions rows + storage objects
// (Phase ROA-1).
//
// All row ownership checks live here. Endpoints call these helpers instead of
// touching Supabase directly, so a missed ownership check cannot exist.
//
// Never log snapshot_json or banking fields.

import { StoragePaths, ROA_STORAGE_BUCKET, getServerSupabase } from './supabaseServer.js';
import { sha256HexOfBytes } from './sha256.js';

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
 */
export async function loadSubmissionForBroker(submissionId, brokerUserId) {
  const row = await loadSubmissionRaw(submissionId);
  if (!row) return null;
  if (row.advisor_user_id !== brokerUserId) return null;
  return row;
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

/** Records the first observed DocuSign completion time without overwriting it. */
export async function setCompletionIfMissing(submissionId, brokerUserId, completedAt) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update({ completed_at: completedAt })
    .eq('id', submissionId)
    .eq('advisor_user_id', brokerUserId)
    .is('completed_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Set completion timestamp failed: ${error.message}`);
  return data;
}

/**
 * Idempotent envelope reservation.
 * Atomically transitions status → 'awaiting_signature' iff no envelope is
 * already recorded and status is currently 'submitted' or 'signature_failed'.
 * Returns { reserved, row } — when `reserved` is false, `row` contains the
 * current state (which will already carry an envelope_id or be in a
 * terminal state).
 */
export async function reserveEnvelopeSlot(submissionId, brokerUserId) {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from('roa_submissions')
    .update({ status: 'awaiting_signature', sent_for_signature_at: new Date().toISOString() })
    .eq('id', submissionId)
    .eq('advisor_user_id', brokerUserId)
    .is('docusign_envelope_id', null)
    .in('status', ['submitted', 'signature_failed'])
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Reserve envelope slot failed: ${error.message}`);
  if (data) return { reserved: true, row: data };
  const current = await loadSubmissionForBroker(submissionId, brokerUserId);
  return { reserved: false, row: current };
}

/** Rolls a reservation back so the broker can retry after a definite failure. */
export async function releaseEnvelopeReservation(submissionId, brokerUserId, { reason } = {}) {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from('roa_submissions')
    .update({
      status: 'signature_failed',
      sent_for_signature_at: null,
      docusign_status: reason ? `failed: ${reason}`.slice(0, 200) : 'failed',
    })
    .eq('id', submissionId)
    .eq('advisor_user_id', brokerUserId)
    .eq('status', 'awaiting_signature')
    .is('docusign_envelope_id', null);
  if (error) throw new Error(`Release envelope reservation failed: ${error.message}`);
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
