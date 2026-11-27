import { randomUUID, createHash } from 'node:crypto';
import { getServerSupabase, ROA_STORAGE_BUCKET } from './supabaseServer.js';
import { loadSubmissionForBroker, ensurePdfStored, downloadPdf } from './submissionRepo.js';
import { sha256HexOfBytes } from './sha256.js';

export const isRequestId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export const newRequestId = () => randomUUID();
export const followupPath = (id, name) => `followups/${id}/${name}`;

export async function findFollowup(id) {
  const { data, error } = await getServerSupabase().from('roa_followup_requests')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function ownedFollowup(id, broker) {
  const request = await findFollowup(id);
  if (!request) return null;
  const submission = await loadSubmissionForBroker(request.submission_id, broker);
  return submission && request.advisor_email.toLowerCase() === broker.normalizedEmail
    ? { request, submission } : null;
}

export async function listFollowups(submissionId, broker) {
  const submission = await loadSubmissionForBroker(submissionId, broker);
  if (!submission) return null;
  const { data, error } = await getServerSupabase().from('roa_followup_requests')
    .select('*').eq('submission_id', submissionId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).filter(row => row.advisor_email.toLowerCase() === broker.normalizedEmail);
}

export async function insertFollowup(row) {
  const { data, error } = await getServerSupabase().from('roa_followup_requests')
    .insert(row).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateFollowup(id, patch) {
  const { data, error } = await getServerSupabase().from('roa_followup_requests')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function reserveFollowupSend(id) {
  const { data, error } = await getServerSupabase().from('roa_followup_requests')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', id).in('status', ['draft', 'failed']).is('envelope_id', null)
    .select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function storeFollowupPdf(path, bytes) {
  const hash = sha256HexOfBytes(bytes);
  await ensurePdfStored(path, bytes, { expectedSha256: hash });
  return hash;
}

export async function verifiedFollowupBytes(path, expectedHash) {
  if (!path || !expectedHash) throw new Error('evidence_unavailable');
  const bytes = await downloadPdf(path);
  if (sha256HexOfBytes(bytes) !== expectedHash) throw new Error('evidence_hash_mismatch');
  return bytes;
}

export function hashAccessToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function storeProof(path, bytes, contentType) {
  const { error } = await getServerSupabase().storage.from(ROA_STORAGE_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
  return sha256HexOfBytes(bytes);
}

export async function attachProof(id, { path, hash, contentType }) {
  const { data, error } = await getServerSupabase().from('roa_followup_requests')
    .update({ proof_path: path, proof_sha256: hash, proof_content_type: contentType,
      updated_at: new Date().toISOString() })
    .eq('id', id).is('proof_path', null).select('*').maybeSingle();
  if (error) throw error;
  if (data) return data;
  const current = await findFollowup(id);
  if (current?.proof_sha256 === hash) return current;
  throw new Error('proof_conflict');
}

export function publicFollowup(row) {
  return {
    id: row.id, submissionId: row.submission_id, kind: row.kind, status: row.status,
    signerName: row.signer_name, signerEmail: row.signer_email,
    signaturePage: row.signature_page, signatureX: row.signature_x,
    signatureY: row.signature_y, hasSource: Boolean(row.source_path),
    hasSigned: Boolean(row.signed_path), hasCertificate: Boolean(row.certificate_path),
    hasAudit: Boolean(row.audit_path), proofReceived: Boolean(row.proof_path),
    createdAt: row.created_at, sentAt: row.sent_at, completedAt: row.completed_at,
    lastReminderAt: row.last_reminder_at,
    crmSyncStatus: row.crm_sync_status, crmSyncError: row.crm_sync_error,
  };
}
