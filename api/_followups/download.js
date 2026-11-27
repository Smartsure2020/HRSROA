import { requireAuthenticatedBroker } from '../_lib/auth.js';
import { isRequestId, ownedFollowup, verifiedFollowupBytes } from '../_lib/followupRepo.js';

const FILES = {
  source: ['source_path', 'source_sha256', 'application/pdf'],
  signed: ['signed_path', 'signed_sha256', 'application/pdf'],
  certificate: ['certificate_path', 'certificate_sha256', 'application/pdf'],
  audit: ['audit_path', 'audit_sha256', 'application/pdf'],
  proof: ['proof_path', 'proof_sha256', null],
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const broker = await requireAuthenticatedBroker(req, res);
  if (!broker) return;
  const id = req.query?.id;
  const kind = req.query?.kind;
  if (!isRequestId(id) || !FILES[kind]) return res.status(400).json({ error: 'invalid_request' });
  const owned = await ownedFollowup(id, broker);
  if (!owned) return res.status(404).json({ error: 'not_found' });
  const row = owned.request;
  const [pathKey, hashKey, defaultType] = FILES[kind];
  if (!row[pathKey]) return res.status(409).json({ error: 'evidence_unavailable' });
  try {
    const bytes = await verifiedFollowupBytes(row[pathKey], row[hashKey]);
    res.setHeader('Content-Type', defaultType || row.proof_content_type);
    res.setHeader('Content-Disposition', `attachment; filename="${id}-${kind}"`);
    return res.status(200).send(bytes);
  } catch { return res.status(500).json({ error: 'evidence_unavailable' }); }
}
