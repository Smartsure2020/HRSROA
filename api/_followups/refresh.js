import { requireAuthenticatedBroker } from '../_lib/auth.js';
import {
  getDocumensoEnvelopeStatus, downloadDocumensoSignedPdf,
  downloadDocumensoCertificate, downloadDocumensoAuditLog,
} from '../_lib/documensoClient.js';
import {
  followupPath, isRequestId, ownedFollowup, publicFollowup,
  storeFollowupPdf, updateFollowup,
} from '../_lib/followupRepo.js';
import { maybeSyncFollowupToCrm } from '../_lib/followupCrm.js';

export async function refreshFollowup(row) {
  if (!row.envelope_id || row.status === 'completed' && row.signed_path && row.certificate_path && row.audit_path) {
    return row;
  }
  const observed = await getDocumensoEnvelopeStatus(row.envelope_id);
  const patch = {};
  if (observed.status === 'COMPLETED') {
    const evidence = [
      ['signed_path', 'signed_sha256', 'signed.pdf', () => downloadDocumensoSignedPdf(row.envelope_item_id || observed.envelopeItemId)],
      ['certificate_path', 'certificate_sha256', 'certificate.pdf', () => downloadDocumensoCertificate(row.envelope_id)],
      ['audit_path', 'audit_sha256', 'audit.pdf', () => downloadDocumensoAuditLog(row.envelope_id)],
    ];
    for (const [pathKey, hashKey, filename, fetchBytes] of evidence) {
      if (row[pathKey]) continue;
      try {
        const bytes = await fetchBytes();
        const path = followupPath(row.id, filename);
        patch[pathKey] = path;
        patch[hashKey] = await storeFollowupPdf(path, bytes);
      } catch { /* later refresh retries missing evidence */ }
    }
    if ((row.signed_path || patch.signed_path) && (row.certificate_path || patch.certificate_path)
      && (row.audit_path || patch.audit_path)) {
      patch.status = 'completed';
      patch.completed_at = observed.completedAt || new Date().toISOString();
    }
  } else if (observed.status === 'REJECTED') patch.status = 'declined';
  else if (observed.status === 'PENDING') patch.status = 'pending';
  return Object.keys(patch).length ? updateFollowup(row.id, patch) : row;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const broker = await requireAuthenticatedBroker(req, res);
  if (!broker) return;
  const id = req.body?.id;
  if (!isRequestId(id)) return res.status(400).json({ error: 'invalid_request_id' });
  const owned = await ownedFollowup(id, broker);
  if (!owned) return res.status(404).json({ error: 'not_found' });
  try {
    return res.status(200).json({ request: publicFollowup(await maybeSyncFollowupToCrm(await refreshFollowup(owned.request))) });
  } catch {
    return res.status(502).json({ error: 'provider_refresh_failed' });
  }
}
