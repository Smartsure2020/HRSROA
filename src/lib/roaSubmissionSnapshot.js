// Freeze the ROA submission snapshot (Phase ROA-1).
//
// A submission snapshot is the exact, immutable data record that produced the
// canonical PDF. Once created it never changes. Live wizard `formData` can
// keep editing in the UI but MUST NOT drive PDF download, notification email,
// signing-provider document, or evidence retention — those all read the frozen
// snapshot (or the canonical bytes derived from it).
//
// The snapshot captures:
//   • a stable submission id (UUID prefixed ROA-)
//   • the roa type
//   • the conditionally-cleaned formData deep-cloned + frozen
//   • the compliance-content versions active at submit time
//   • the PDF template version active at submit time
//
// The snapshot itself does NOT include the signature dataURLs — those live in
// the canonical PDF bytes. Keeping them out of snapshot_json keeps DB rows
// modest and avoids duplicating the same visual signature into two places.

import { HRS_COMPLIANCE_CONTENT } from './hrsComplianceContent.js';
import { HRS_TEMPLATE_VERSION } from './pdf/templateVersion.js';

const SUBMISSION_ID_PREFIX = 'ROA-';

/**
 * Cryptographically random UUIDv4-based submission id.
 * Uses `crypto.randomUUID()` in browser and Node ≥14.17 alike.
 */
export function generateSubmissionId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid !== 'string' || uuid.length === 0) {
    throw new Error('crypto.randomUUID is unavailable — cannot mint an ROA submission id');
  }
  return `${SUBMISSION_ID_PREFIX}${uuid}`;
}

/** True if the given string looks like a valid ROA submission id. */
export function isSubmissionId(value) {
  return (
    typeof value === 'string' &&
    value.startsWith(SUBMISSION_ID_PREFIX) &&
    /^ROA-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
  );
}

/** Returns the compliance/template versions active at submit time. */
export function currentComplianceVersions() {
  return Object.freeze({
    templateVersion: HRS_TEMPLATE_VERSION,
    statutoryDisclosureVersion: HRS_COMPLIANCE_CONTENT.statutoryDisclosure.version,
    brokerAppointmentVersion: HRS_COMPLIANCE_CONTENT.brokerAppointment.version,
    brokerFeeVersion: HRS_COMPLIANCE_CONTENT.brokerFeeConsent.version,
    letterInvestigationVersion: HRS_COMPLIANCE_CONTENT.letterOfInvestigation.version,
  });
}

/** Deep-clone helper that preserves plain data (arrays, objects, primitives). */
function deepClonePlain(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Deep-freeze helper. */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = obj[prop];
    if (value && typeof value === 'object') deepFreeze(value);
  });
  return Object.freeze(obj);
}

/**
 * Strips volatile / large fields the DB snapshot should not carry — signature
 * dataURLs live in the canonical PDF bytes; storing them separately in the DB
 * blob would duplicate the same evidence and expand row size for no benefit.
 */
export function sanitiseSnapshotForPersistence(snapshot) {
  const copy = { ...snapshot };
  delete copy.clientSig;
  delete copy.advisorSig;
  return copy;
}

/**
 * Creates a frozen submission snapshot from validated formData. The caller
 * has already validated the wizard and applied conditional cleanup — this
 * function still applies the shared cleanup once more so a snapshot cannot
 * possibly carry residual stale conditional children.
 *
 * @param {'Personal'|'Commercial'} roaType
 * @param {object} formData
 * @param {object} [options]
 * @param {(fd: object) => object} [options.applyCleanup] flow-specific cleanup
 * @param {string} [options.submissionId] override (tests only)
 * @returns {{
 *   submissionId: string,
 *   roaType: 'Personal'|'Commercial',
 *   snapshot: object,          // frozen deep-clone of formData (with signatures)
 *   snapshotForDb: object,     // frozen deep-clone without signature dataURLs
 *   versions: object           // frozen compliance/template versions
 * }}
 */
export function createSubmissionSnapshot(roaType, formData, options = {}) {
  if (roaType !== 'Personal' && roaType !== 'Commercial') {
    throw new Error(`createSubmissionSnapshot: unsupported roaType ${JSON.stringify(roaType)}`);
  }
  if (!formData || typeof formData !== 'object') {
    throw new Error('createSubmissionSnapshot: formData is required');
  }

  const cleaned = typeof options.applyCleanup === 'function'
    ? options.applyCleanup(formData)
    : formData;

  const cloned = deepClonePlain(cleaned);
  const snapshot = deepFreeze(cloned);
  const snapshotForDb = deepFreeze(sanitiseSnapshotForPersistence(deepClonePlain(cleaned)));
  const versions = currentComplianceVersions();
  const submissionId = options.submissionId ?? generateSubmissionId();

  return Object.freeze({ submissionId, roaType, snapshot, snapshotForDb, versions });
}
