import { updateFollowup, verifiedFollowupBytes } from './followupRepo.js';

const evidence = [
  ['source', 'source_path', 'source_sha256'],
  ['signed', 'signed_path', 'signed_sha256'],
  ['certificate', 'certificate_path', 'certificate_sha256'],
  ['audit', 'audit_path', 'audit_sha256'],
  ['proof', 'proof_path', 'proof_sha256'],
];

export async function syncFollowupToCrm(row) {
  const baseUrl = process.env.CRM_BASE_URL;
  const secret = process.env.CRM_INTEGRATION_SECRET;
  if (!baseUrl || !secret || secret.length < 32) throw new Error('crm_not_configured');
  const url = new URL('/api/integrations/roa-followup-sync', baseUrl);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('crm_base_url_insecure');
  const files = {};
  for (const [key, pathKey, hashKey] of evidence) {
    if (!row[pathKey]) continue;
    const bytes = await verifiedFollowupBytes(row[pathKey], row[hashKey]);
    files[key] = {
      base64: bytes.toString('base64'), sha256: row[hashKey],
      contentType: key === 'proof' ? row.proof_content_type : 'application/pdf',
    };
  }
  const payload = {
    requestId: row.id, submissionId: row.submission_id, adviserEmail: row.advisor_email,
    kind: row.kind, status: row.status, signerName: row.signer_name,
    signerEmail: row.signer_email, sentAt: row.sent_at, completedAt: row.completed_at,
    evidence: files,
  };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };
  if (process.env.CRM_VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.CRM_VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify(payload), signal: controller.signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.requestId !== row.id) throw new Error(result.error || 'crm_sync_failed');
    return updateFollowup(row.id, { crm_sync_status: 'linked', crm_sync_error: null,
      crm_synced_at: new Date().toISOString() });
  } catch (error) {
    await updateFollowup(row.id, { crm_sync_status: 'failed', crm_sync_error: error.message || 'crm_sync_failed' });
    throw error;
  } finally { clearTimeout(timer); }
}

export async function maybeSyncFollowupToCrm(row) {
  if (!['pending', 'completed', 'declined'].includes(row.status)) return row;
  try { return await syncFollowupToCrm(row); }
  catch (error) { console.warn('Follow-up CRM sync deferred:', error?.message || 'sync_failed'); return row; }
}
