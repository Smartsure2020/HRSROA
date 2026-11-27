import { timingSafeEqual } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getDocumensoEnvelope } from '../_lib/documensoClient.js';
import {
  attachProof, findFollowup, followupPath, hashAccessToken, isRequestId,
  storeProof,
} from '../_lib/followupRepo.js';
import { downloadPdf } from '../_lib/submissionRepo.js';
import { sha256HexOfBytes } from '../_lib/sha256.js';
import { maybeSyncFollowupToCrm } from '../_lib/followupCrm.js';

export const config = { api: { bodyParser: { sizeLimit: '9mb' } } };

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPng(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8;
  let image = false;
  let pixels = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const end = offset + 12 + length;
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
    if (!image) {
      if (type !== 'IHDR' || length !== 13) return false;
      const width = bytes.readUInt32BE(offset + 8);
      const height = bytes.readUInt32BE(offset + 12);
      if (!width || !height || width > 10000 || height > 10000) return false;
      image = true;
    }
    if (type === 'IDAT') pixels = true;
    if (type === 'IEND') return pixels && length === 0 && end === bytes.length;
    offset = end;
  }
  return false;
}

function validJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
  let offset = 2;
  let dimensions = false;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    if (marker === 0xda) return dimensions && bytes.readUInt16BE(offset + 2) >= 6;
    if (marker === 0xd9) return false;
    const size = bytes.readUInt16BE(offset + 2);
    if (size < 2 || offset + 2 + size > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      if (size < 8) return false;
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      if (!width || !height || width > 10000 || height > 10000) return false;
      dimensions = true;
    }
    offset += 2 + size;
  }
  return false;
}

export function proofFileType(bytes) {
  if (bytes.subarray(0, 5).toString() === '%PDF-' && bytes.includes(Buffer.from('%%EOF'))) return 'application/pdf';
  if (bytes.length > 4 && validJpeg(bytes)) return 'image/jpeg';
  if (bytes.length > 28 && validPng(bytes)) return 'image/png';
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  const id = req.method === 'GET' ? req.query?.id : req.body?.id;
  if (!isRequestId(id)) return res.status(400).json({ error: 'invalid_request_id' });
  const row = await findFollowup(id);
  const token = String(req.headers?.authorization || '').replace(/^Bearer /, '');
  const actual = Buffer.from(hashAccessToken(token), 'hex');
  const expected = Buffer.from(row?.proof_access_hash || '', 'hex');
  if (!row || row.kind !== 'banking' || !token || expected.length !== actual.length
    || !timingSafeEqual(actual, expected)) return res.status(404).json({ error: 'not_found' });
  if (req.method === 'GET') return res.status(200).json({ proofReceived: Boolean(row.proof_path) });
  if (row.proof_path) return res.status(200).json({ proofReceived: true, repeated: true });
  const base64 = req.body?.fileBase64;
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return res.status(400).json({ error: 'invalid_file' });
  }
  const bytes = Buffer.from(base64, 'base64');
  const contentType = proofFileType(bytes);
  if (!contentType || bytes.length < 100 || bytes.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'invalid_file' });
  }
  if (contentType === 'application/pdf') {
    try {
      const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
      await pdf.destroy();
    } catch { return res.status(400).json({ error: 'invalid_file' }); }
  }
  try {
    const envelope = await getDocumensoEnvelope(row.envelope_id);
    const signed = envelope?.recipients?.some(recipient =>
      recipient.email?.toLowerCase() === row.signer_email.toLowerCase()
      && String(recipient.signingStatus).toUpperCase() === 'SIGNED');
    if (!signed) return res.status(409).json({ error: 'signing_not_complete' });
    const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[contentType];
    const path = followupPath(id, `proof-${sha256HexOfBytes(bytes)}.${extension}`);
    let hash;
    try { hash = await storeProof(path, bytes, contentType); }
    catch (error) {
      // A prior upload can have committed before its metadata write failed.
      const existing = await downloadPdf(path).catch(() => null);
      if (!existing || sha256HexOfBytes(existing) !== sha256HexOfBytes(bytes)) throw error;
      hash = sha256HexOfBytes(existing);
    }
    const updated = await attachProof(id, { path, hash, contentType });
    await maybeSyncFollowupToCrm(updated);
    return res.status(200).json({ proofReceived: true });
  } catch {
    return res.status(502).json({ error: 'proof_upload_failed' });
  }
}
