// Amend ROA — shared rules (Issue #8). Browser-safe and imported by the API too, so the
// server and the UI cannot disagree about reasons, eligibility or lineage.
//
// An amendment never edits a submission. It creates the NEXT revision in a linear chain:
//
//   Rev 1 (signed)  <-supersedes-  Rev 2 (awaiting signature)  <-supersedes-  Rev 3 ...
//
// Every revision has its own ROA-<uuid>, canonical PDF + SHA-256, signing envelope and
// CRM evidence. An older revision's status and evidence stay exactly as they were.

export const AMEND_REASONS = Object.freeze([
  { code: 'incorrect_contact_details', label: 'Incorrect contact details' },
  { code: 'incorrect_email', label: 'Incorrect email' },
  { code: 'spelling_correction', label: 'Spelling correction' },
  { code: 'change_in_cover_or_recommendation', label: 'Change in cover or recommendation' },
  { code: 'client_information_changed', label: 'Client information changed' },
  { code: 'other', label: 'Other' },
]);

export const AMEND_REASON_CODES = Object.freeze(AMEND_REASONS.map((reason) => reason.code));
export const AMEND_DETAIL_MAX = 500;
export const AMEND_DETAIL_MIN_FOR_OTHER = 3;

export function isAmendReason(code) {
  return typeof code === 'string' && AMEND_REASON_CODES.includes(code);
}

export function amendReasonLabel(code) {
  return AMEND_REASONS.find((reason) => reason.code === code)?.label || null;
}

/**
 * Validates the broker-supplied reason. The detail is mandatory for "Other" and optional
 * otherwise; it is trimmed and length-bounded. Mirrors the database CHECK constraints.
 *
 * @returns {{ ok: true, reason: string, reasonDetail: string|null } | { ok: false, error: string }}
 */
export function validateAmendmentReason({ reason, reasonDetail } = {}) {
  if (!isAmendReason(reason)) return { ok: false, error: 'invalid_amendment_reason' };
  if (reasonDetail != null && typeof reasonDetail !== 'string') {
    return { ok: false, error: 'invalid_amendment_reason_detail' };
  }
  const detail = typeof reasonDetail === 'string' ? reasonDetail.trim() : '';
  if (detail.length > AMEND_DETAIL_MAX) return { ok: false, error: 'invalid_amendment_reason_detail' };
  if (reason === 'other' && detail.length < AMEND_DETAIL_MIN_FOR_OTHER) {
    return { ok: false, error: 'amendment_reason_detail_required' };
  }
  return { ok: true, reason, reasonDetail: detail || null };
}

// ---------- eligibility ------------------------------------------------------

export const SUBMISSION_STATUSES = Object.freeze([
  'submitted', 'awaiting_signature', 'signature_failed', 'completed', 'declined', 'voided', 'expired',
]);

/** Statuses in which no signing request can still be live. */
const NOT_LIVE_STATUSES = new Set(['completed', 'declined', 'voided', 'expired']);

/**
 * Why a submission cannot be amended right now, or null when it can.
 *
 * Takes the minimal facts so it works for both a database row and the browser's view:
 *   { status, supersededBySubmissionId, hasEnvelope, signingProvider }
 *
 * Rules:
 *   • only the head of a chain can be amended (a linear chain has one successor);
 *   • all seven statuses are amendable — the status decides what finalisation must do
 *     (see ./api/_lib/supersession.js), not whether the broker may edit;
 *   • a still-live legacy DocuSign envelope cannot be cancelled by this app, so the
 *     amendment fails closed until it is voided in DocuSign and the register refreshed.
 */
export function amendmentBlockReason({
  status,
  supersededBySubmissionId = null,
  hasEnvelope = false,
  signingProvider = null,
} = {}) {
  if (!SUBMISSION_STATUSES.includes(status)) return 'status_not_amendable';
  if (supersededBySubmissionId) return 'already_superseded';
  if (hasEnvelope && !NOT_LIVE_STATUSES.has(status) && signingProvider !== 'documenso') {
    return 'legacy_provider_manual_void_required';
  }
  return null;
}

/** True when sending the replacement will first have to cancel a live signing request. */
export function amendmentWillCancelSigningRequest({ status, hasEnvelope = false } = {}) {
  return Boolean(hasEnvelope) && !NOT_LIVE_STATUSES.has(status);
}

/**
 * Marks the broker notification email as an amendment. The free-text note is deliberately
 * left out (it may contain personal detail); the attached canonical PDF stays authoritative.
 */
export function withAmendmentNotice({ subject, body }, { nextRevisionNo, reason }) {
  const label = amendReasonLabel(reason) || 'Amendment';
  return {
    subject: `AMENDED (Revision ${nextRevisionNo}) – ${subject}`,
    body: `AMENDED ADVICE RECORD — REVISION ${nextRevisionNo}\n`
      + `Reason: ${label}\n`
      + 'This revision replaces the previous one. The attached PDF is authoritative.\n\n'
      + body,
  };
}

export const AMENDMENT_BLOCK_MESSAGES = Object.freeze({
  predecessor_not_found: 'The ROA being amended could not be found.',
  roa_type_mismatch: 'An amendment cannot change the ROA type.',
  revision_conflict: 'Another revision of this ROA was created at the same time. Open My ROAs and amend the latest revision.',
  submission_conflict: 'This revision reference is already in use. Please submit again.',
  status_not_amendable: 'This ROA is in a state that cannot be amended.',
  already_superseded: 'A newer revision of this ROA already exists. Amend the latest revision instead.',
  legacy_provider_manual_void_required:
    'This ROA has a live DocuSign signing request. Void it in DocuSign, refresh My ROAs, then amend.',
  invalid_amendment_reason: 'Choose a reason for the amendment.',
  invalid_amendment_reason_detail: 'The amendment note is too long.',
  amendment_reason_detail_required: 'Describe the reason when you choose "Other".',
});

// ---------- lineage ----------------------------------------------------------

/** Root (revision 1) id of the chain an item belongs to. Works on the browser view shape. */
export function chainRootId(item) {
  return item?.parentSubmissionId || item?.submissionId || null;
}

export function revisionNumber(item) {
  const n = Number(item?.revisionNo);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function revisionLabel(item) {
  return `Rev ${revisionNumber(item)}`;
}

/** Signed state is kept apart from lineage: a revision is "signed" only when it completed. */
export function isSignedRevision(item) {
  return item?.status === 'completed';
}

const FAILED_REPLACEMENT_STATUSES = new Set(['declined', 'voided', 'expired']);

/** Groups register items into chains, oldest revision first. */
export function buildRevisionChains(items) {
  const chains = new Map();
  for (const item of items || []) {
    const root = chainRootId(item);
    if (!root) continue;
    if (!chains.has(root)) chains.set(root, []);
    chains.get(root).push(item);
  }
  for (const chain of chains.values()) chain.sort((a, b) => revisionNumber(a) - revisionNumber(b));
  return chains;
}

/**
 * Summarises one chain for the register.
 *   lastSigned          the newest completed revision — the last signed ROA on record;
 *   head                the newest revision (the only one that can be amended);
 *   replacementPending  the head when it is newer than the last signed revision and still
 *                       in play (not declined / voided / expired);
 *   replacementFailed   the head when it is newer than the last signed revision but dead.
 */
export function summariseChain(chain) {
  const ordered = [...(chain || [])].sort((a, b) => revisionNumber(a) - revisionNumber(b));
  const head = ordered.at(-1) || null;
  const lastSigned = [...ordered].reverse().find(isSignedRevision) || null;
  const newerThanSigned = head && (!lastSigned || revisionNumber(head) > revisionNumber(lastSigned));
  const replacementPending = newerThanSigned && lastSigned && !FAILED_REPLACEMENT_STATUSES.has(head.status)
    ? head
    : null;
  const replacementFailed = newerThanSigned && lastSigned && FAILED_REPLACEMENT_STATUSES.has(head.status)
    ? head
    : null;
  return { revisions: ordered, head, lastSigned, replacementPending, replacementFailed };
}

/** The chain an item belongs to, from a flat register list. */
export function chainForItem(items, item) {
  return buildRevisionChains(items).get(chainRootId(item)) || [item];
}

/**
 * A revision's own signing state, deliberately independent of its lineage: a superseded
 * revision keeps reading "Signed" if it was signed, and a pending replacement reads
 * "Awaiting signature" without changing what the revision before it was.
 */
export function revisionStateLabel(item) {
  switch (item?.status) {
    case 'completed': return 'Signed';
    case 'awaiting_signature': return 'Awaiting signature';
    case 'declined': return 'Declined';
    case 'voided': return 'Voided';
    case 'expired': return 'Expired';
    case 'signature_failed': return 'Send failed';
    case 'submitted': return 'Not sent for signature';
    default: return item?.status || '—';
  }
}

/** One-line summary of how a revision relates to the rest of its chain, or null for a lone original. */
export function lineageSummary(item, items) {
  if (!item || (revisionNumber(item) === 1 && !item.supersededBySubmissionId)) return null;
  const chain = summariseChain(chainForItem(items, item));
  const parts = [];
  parts.push(chain.lastSigned ? `Last signed: ${revisionLabel(chain.lastSigned)}` : 'No revision signed yet');
  if (chain.replacementPending) {
    parts.push(`${revisionLabel(chain.replacementPending)} replacement: ${revisionStateLabel(chain.replacementPending).toLowerCase()}`);
  } else if (chain.replacementFailed) {
    parts.push(
      `${revisionLabel(chain.replacementFailed)} replacement ${revisionStateLabel(chain.replacementFailed).toLowerCase()}`
      + ` — ${revisionLabel(chain.lastSigned)} remains the signed ROA`,
    );
  }
  return parts.join(' · ');
}
