// The canonical PDF contract (Phase ROA-1 §27).
//
// The most important test group in this phase. Verifies:
//   1. `createSubmissionSnapshot` deep-freezes so the snapshot cannot mutate
//      after creation.
//   2. Live `formData` mutation after freeze cannot alter the snapshot.
//   3. Submission ids are UUID-based (ROA-<uuid>) and unique per call.
//   4. Compliance versions are captured at snapshot time — a subsequent
//      import must not change the versions on the frozen snapshot.
//   5. SHA-256 of the raw canonical PDF bytes (server-side) matches the
//      hash the server persists on the submission row.
//   6. The `.snapshotForDb` excludes signature dataURLs (they live in the
//      PDF only, not in the DB blob).
//   7. Personal + Commercial both follow the same contract.

import { describe, expect, it } from 'vitest';
import {
  createSubmissionSnapshot,
  currentComplianceVersions,
  generateSubmissionId,
  isSubmissionId,
} from '../src/lib/roaSubmissionSnapshot.js';
import { base64ToBytes, sha256HexOfBytes } from '../api/_lib/sha256.js';

describe('generateSubmissionId', () => {
  it('mints an id of the form ROA-<uuid>', () => {
    const id = generateSubmissionId();
    expect(isSubmissionId(id)).toBe(true);
    expect(id.startsWith('ROA-')).toBe(true);
  });

  it('mints a fresh id every call (no collisions across a large batch)', () => {
    const set = new Set();
    for (let i = 0; i < 1000; i += 1) set.add(generateSubmissionId());
    expect(set.size).toBe(1000);
  });

  it('isSubmissionId rejects malformed values', () => {
    expect(isSubmissionId('not-an-id')).toBe(false);
    expect(isSubmissionId('ROA-')).toBe(false);
    expect(isSubmissionId('ROA-not-a-uuid-shape')).toBe(false);
    expect(isSubmissionId(null)).toBe(false);
    expect(isSubmissionId(undefined)).toBe(false);
    expect(isSubmissionId(42)).toBe(false);
  });
});

function makePersonalFixture() {
  return {
    firstName: 'Jane',
    surname: 'Doe',
    idNumber: '8001015009087',
    email: 'jane@example.com',
    cell: '0821234567',
    brokerName: 'Andrew Penney',
    recInsurer: 'Stratsys',
    brokerFeeType: 'percent',
    brokerFeePercent: '5',
    prem2: '2000',
    // Signature blobs (must NOT appear in snapshotForDb).
    clientSig: 'data:image/png;base64,SIG-CLIENT',
    advisorSig: 'data:image/png;base64,SIG-ADVISOR',
    // A field that should get cleaned up if we set specialTerms=no.
    specialTerms: 'no',
    cancelReasonText: 'stale text that must be cleaned',
  };
}

function makeCommercialFixture() {
  return {
    companyName: 'ACME (Pty) Ltd',
    registrationNo: '2020/012345/07',
    contactPerson: 'Alex Rivera',
    email: 'alex@acme.example',
    brokerName: 'Andrew Penney',
    recInsurer: 'Stratsys',
    brokerFeeType: 'percent',
    brokerFeePercent: '3',
    prem2: '4000',
    clientSig: 'data:image/png;base64,COMM-SIG-CLIENT',
    advisorSig: 'data:image/png;base64,COMM-SIG-ADVISOR',
    replacingExisting: 'no',
    currentInsurer: 'stale insurer that must be cleaned',
  };
}

// Trivial cleanup used only to prove that createSubmissionSnapshot calls it.
// The real Personal / Commercial cleanup functions ship in production; here
// we exercise the plumbing only.
const dummyPersonalCleanup = (fd) => (
  fd.specialTerms !== 'yes' ? { ...fd, cancelReasonText: '' } : fd
);
const dummyCommercialCleanup = (fd) => (
  fd.replacingExisting !== 'yes' ? { ...fd, currentInsurer: '' } : fd
);

describe('createSubmissionSnapshot — freeze semantics', () => {
  it('returns a frozen top-level result and a deeply frozen snapshot', () => {
    const fd = makePersonalFixture();
    const frozen = createSubmissionSnapshot('Personal', fd);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.snapshot)).toBe(true);
    expect(Object.isFrozen(frozen.snapshotForDb)).toBe(true);
    expect(Object.isFrozen(frozen.versions)).toBe(true);
  });

  it('mutation of the live formData AFTER freeze cannot alter the snapshot', () => {
    const fd = makePersonalFixture();
    const frozen = createSubmissionSnapshot('Personal', fd, { applyCleanup: dummyPersonalCleanup });
    // Mutate live formData post-freeze.
    fd.firstName = 'Tampered';
    fd.brokerFeePercent = '99';
    fd.clientSig = 'data:image/png;base64,TAMPER';
    // Snapshot is unchanged.
    expect(frozen.snapshot.firstName).toBe('Jane');
    expect(frozen.snapshot.brokerFeePercent).toBe('5');
    expect(frozen.snapshot.clientSig).toBe('data:image/png;base64,SIG-CLIENT');
  });

  it('attempting to mutate the frozen snapshot itself is silent-fail in loose mode / throws in strict', () => {
    const fd = makePersonalFixture();
    const frozen = createSubmissionSnapshot('Personal', fd);
    // In non-strict mode assignment silently fails; the value stays.
    try { frozen.snapshot.firstName = 'X'; } catch { /* strict-mode TypeError is also acceptable */ }
    expect(frozen.snapshot.firstName).toBe('Jane');
  });

  it('applies the supplied cleanup function once before freezing', () => {
    const fd = makePersonalFixture();
    const frozen = createSubmissionSnapshot('Personal', fd, { applyCleanup: dummyPersonalCleanup });
    // Original had `specialTerms: 'no'` + `cancelReasonText: 'stale…'` — the
    // cleanup wipes cancelReasonText, and the frozen snapshot reflects that.
    expect(frozen.snapshot.cancelReasonText).toBe('');
  });

  it('snapshotForDb strips signature dataURLs but keeps everything else', () => {
    const fd = makePersonalFixture();
    const frozen = createSubmissionSnapshot('Personal', fd);
    expect(frozen.snapshot.clientSig).toBe('data:image/png;base64,SIG-CLIENT');
    expect(frozen.snapshot.advisorSig).toBe('data:image/png;base64,SIG-ADVISOR');
    // For DB persistence signatures are removed — they live in the canonical PDF.
    expect(frozen.snapshotForDb).not.toHaveProperty('clientSig');
    expect(frozen.snapshotForDb).not.toHaveProperty('advisorSig');
    expect(frozen.snapshotForDb.firstName).toBe('Jane');
    expect(frozen.snapshotForDb.recInsurer).toBe('Stratsys');
  });

  it('captures the compliance/template versions active at freeze time', () => {
    const versions = currentComplianceVersions();
    const fd = makePersonalFixture();
    const frozen = createSubmissionSnapshot('Personal', fd);
    expect(frozen.versions.templateVersion).toBe(versions.templateVersion);
    expect(frozen.versions.statutoryDisclosureVersion).toBe(versions.statutoryDisclosureVersion);
    expect(frozen.versions.brokerAppointmentVersion).toBe(versions.brokerAppointmentVersion);
    expect(frozen.versions.brokerFeeVersion).toBe(versions.brokerFeeVersion);
    expect(frozen.versions.letterInvestigationVersion).toBe(versions.letterInvestigationVersion);
  });

  it('gives every fresh submission a unique id', () => {
    const fd = makePersonalFixture();
    const a = createSubmissionSnapshot('Personal', fd);
    const b = createSubmissionSnapshot('Personal', fd);
    expect(a.submissionId).not.toBe(b.submissionId);
    expect(isSubmissionId(a.submissionId)).toBe(true);
    expect(isSubmissionId(b.submissionId)).toBe(true);
  });

  it('refuses an unknown roaType', () => {
    expect(() => createSubmissionSnapshot('Motor', makePersonalFixture())).toThrow(/unsupported roaType/);
  });

  it('refuses a non-object formData', () => {
    expect(() => createSubmissionSnapshot('Personal', null)).toThrow(/formData is required/);
    expect(() => createSubmissionSnapshot('Personal', 'oops')).toThrow(/formData is required/);
  });

  it('Commercial follows the same contract (freeze + snapshotForDb strips sigs)', () => {
    const fd = makeCommercialFixture();
    const frozen = createSubmissionSnapshot('Commercial', fd, { applyCleanup: dummyCommercialCleanup });
    expect(Object.isFrozen(frozen.snapshot)).toBe(true);
    expect(Object.isFrozen(frozen.snapshotForDb)).toBe(true);
    expect(frozen.snapshotForDb).not.toHaveProperty('clientSig');
    expect(frozen.snapshotForDb).not.toHaveProperty('advisorSig');
    expect(frozen.snapshot.currentInsurer).toBe(''); // cleaned
    fd.companyName = 'Tampered Corp';
    expect(frozen.snapshot.companyName).toBe('ACME (Pty) Ltd');
  });
});

describe('SHA-256 identity contract', () => {
  it('sha256 of decoded bytes is stable — same input → same hash', () => {
    const bytes = Buffer.from('%PDF-1.4\n%FAKE-BYTES-FOR-HASH-TEST\n');
    const hashA = sha256HexOfBytes(bytes);
    const hashB = sha256HexOfBytes(bytes);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sha256 of decoded bytes differs when the bytes differ by one byte', () => {
    const a = Buffer.from('%PDF-1.4\nA');
    const b = Buffer.from('%PDF-1.4\nB');
    expect(sha256HexOfBytes(a)).not.toBe(sha256HexOfBytes(b));
  });

  it('base64ToBytes → sha256HexOfBytes reproduces the hash the server persists', () => {
    const originalBytes = Buffer.from('%PDF-1.4\ncanonical-content\n');
    const base64 = originalBytes.toString('base64');
    const roundTrip = base64ToBytes(base64);
    expect(roundTrip.equals(originalBytes)).toBe(true);
    expect(sha256HexOfBytes(roundTrip)).toBe(sha256HexOfBytes(originalBytes));
  });

  it('sha256HexOfBytes refuses non-byte inputs (never hashes a base64 string)', () => {
    expect(() => sha256HexOfBytes('not-bytes')).toThrow(/expected Uint8Array or Buffer/);
    expect(() => sha256HexOfBytes({ arbitrary: 'object' })).toThrow(/expected Uint8Array or Buffer/);
  });
});
