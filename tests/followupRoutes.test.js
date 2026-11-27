import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { jsPDF } from 'jspdf';

const id = '11111111-1111-4111-8111-111111111111';
const broker = { normalizedEmail: 'broker@example.test', brokerEmail: 'broker@example.test' };
const baseRow = () => ({ id, submission_id: 'ROA-11111111-1111-4111-8111-111111111111',
  advisor_email: broker.normalizedEmail, kind: 'banking', signer_name: 'Synthetic Client',
  signer_email: 'client@example.test', status: 'draft', source_path: `followups/${id}/source.pdf`,
  source_sha256: 'a'.repeat(64), source_size: 600, updated_at: new Date(0).toISOString(),
  proof_access_hash: createHash('sha256').update('test-token').digest('hex') });
let row;
const mocks = vi.hoisted(() => ({
  create: vi.fn(), find: vi.fn(), distribute: vi.fn(), fields: vi.fn(), get: vi.fn(),
  update: vi.fn(), reserve: vi.fn(), owner: vi.fn(), proofStore: vi.fn(), attachProof: vi.fn(), sync: vi.fn(),
}));
vi.mock('../api/_lib/auth.js', () => ({ requireAuthenticatedBroker: async () => broker }));
vi.mock('../api/_lib/documensoClient.js', () => ({
  isDocumensoConfigured: () => true,
  createFollowupEnvelope: mocks.create,
  findDocumensoEnvelopeByExternalId: mocks.find,
  distributeDocumensoEnvelope: mocks.distribute,
  addFollowupFields: mocks.fields,
  getDocumensoEnvelope: mocks.get,
}));
vi.mock('../api/_lib/followupRepo.js', () => ({
  isRequestId: value => value === '11111111-1111-4111-8111-111111111111',
  ownedFollowup: mocks.owner, reserveFollowupSend: mocks.reserve,
  updateFollowup: mocks.update, verifiedFollowupBytes: async () => Buffer.from('%PDF-' + 'x'.repeat(600)),
  publicFollowup: value => ({ id: value.id, status: value.status, proofReceived: Boolean(value.proof_path) }),
  hashAccessToken: token => createHash('sha256').update(token).digest('hex'),
  findFollowup: async () => row, followupPath: (requestId, name) => `followups/${requestId}/${name}`,
  storeProof: mocks.proofStore,
  attachProof: mocks.attachProof,
}));
vi.mock('../api/_lib/followupCrm.js', () => ({ maybeSyncFollowupToCrm: mocks.sync }));
vi.mock('../api/_lib/submissionRepo.js', () => ({ downloadPdf: async () => null }));

const send = (await import('../api/_followups/send.js')).default;
const proof = (await import('../api/_followups/proof.js')).default;

function res() { return { statusCode: 200, body: null, setHeader() { return this; },
  status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; }

beforeEach(() => {
  vi.clearAllMocks(); row = baseRow();
  process.env.HRS_ROA_PUBLIC_URL = 'https://roa.example.test';
  mocks.owner.mockImplementation(async () => ({ request: row, submission: {} }));
  mocks.reserve.mockImplementation(async () => { if (row.status !== 'draft') return null; row.status = 'sending'; return row; });
  mocks.update.mockImplementation(async (_id, patch) => { row = { ...row, ...patch }; return row; });
  mocks.get.mockImplementation(async () => ({ status: 'DRAFT', meta: {}, recipients: [{ email: row.signer_email, signingStatus: 'SIGNED' }], envelopeItems: [{ id: 'item_1' }] }));
  mocks.create.mockResolvedValue('envelope_1'); mocks.fields.mockResolvedValue('item_1');
  mocks.distribute.mockResolvedValue({}); mocks.sync.mockImplementation(async value => value);
});

describe('follow-up API boundaries', () => {
  it('reserves one request and does not send a second invitation on retry', async () => {
    const first = res(); await send({ method: 'POST', body: { id } }, first);
    expect(first.statusCode).toBe(200);
    const second = res(); await send({ method: 'POST', body: { id } }, second);
    expect(second.statusCode).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.distribute).toHaveBeenCalledTimes(1);
  });

  it('locks an ambiguous provider timeout without issuing another invitation', async () => {
    mocks.create.mockRejectedValueOnce(new Error('timeout'));
    mocks.find.mockResolvedValueOnce(null);
    const first = res(); await send({ method: 'POST', body: { id } }, first);
    expect(first.statusCode).toBe(503);
    const second = res(); await send({ method: 'POST', body: { id } }, second);
    expect(second.statusCode).toBe(409);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('denies a different broker before contacting Documenso', async () => {
    mocks.owner.mockResolvedValueOnce(null);
    const response = res(); await send({ method: 'POST', body: { id } }, response);
    expect(response.statusCode).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('binds proof to the request token and a signed recipient, and never marks a failed upload received', async () => {
    row.status = 'pending'; row.envelope_id = 'envelope_1';
    const bytes = Buffer.from(new jsPDF().output('arraybuffer'));
    const wrong = res(); await proof({ method: 'POST', headers: { authorization: 'Bearer wrong' },
      body: { id, fileBase64: bytes.toString('base64') } }, wrong);
    expect(wrong.statusCode).toBe(404);
    mocks.proofStore.mockRejectedValueOnce(new Error('storage_failed'));
    const response = res(); await proof({ method: 'POST', headers: { authorization: 'Bearer test-token' },
      body: { id, fileBase64: bytes.toString('base64') } }, response);
    expect(response.statusCode).toBe(502);
    expect(row.proof_path).toBeUndefined();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
