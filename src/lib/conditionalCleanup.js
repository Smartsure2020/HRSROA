// Shared conditional-state cleanup (Phase 3, section 6).
//
// These are written as *invariants* rather than "previous vs next" transition checks:
// each function simply asks "given the form's current state, is this child field still
// applicable?" and clears it if not. Applying the same invariant on every change (live
// editing) and once more when a draft is restored (see roaDraftStorage.js) means stale
// child data can never resurface, and the functions are naturally idempotent (safe to
// call repeatedly, no infinite-loop risk).

import { getBrokerFeeSummary } from './brokerFee';

function clearInvestigationFields(formData) {
  if (formData.changingBroker === 'yes') return formData;
  const patch = {};
  let changed = false;
  if (formData.ackLetterOfInvestigation) {
    patch.ackLetterOfInvestigation = false;
    changed = true;
  }
  // Generic guard for any future Letter-of-Investigation-specific field — clears anything
  // whose key mentions "investigat[ion]" once changingBroker is no longer 'yes'.
  Object.keys(formData).forEach((k) => {
    if (k === 'changingBroker' || k === 'ackLetterOfInvestigation') return;
    if (/investigat/i.test(k) && formData[k]) {
      patch[k] = typeof formData[k] === 'boolean' ? false : '';
      changed = true;
    }
  });
  return changed ? { ...formData, ...patch } : formData;
}

function clearStaleBrokerFeeConsent(formData) {
  const fee = getBrokerFeeSummary(formData);
  if (!fee.consentRequired && formData.ackBrokerFee) {
    return { ...formData, ackBrokerFee: false };
  }
  return formData;
}

function clearStalePolicyTypeFields(formData) {
  const applicable = formData.policyType === 'Renewal' || formData.policyType === 'Replacement';
  if (!applicable && formData.existingPolicyRef) {
    return { ...formData, existingPolicyRef: '' };
  }
  return formData;
}

function clearStaleElectionInitials(formData) {
  const electedAlternative = formData.electionDiffers || formData.electionNotFollow || formData.electionLimitedInfo;
  if (!electedAlternative && formData.electionInitials) {
    return { ...formData, electionInitials: '' };
  }
  return formData;
}

/** Invariants shared by both the Personal and Commercial flows. */
export function applySharedConditionalCleanup(formData) {
  if (!formData) return formData;
  let next = formData;
  next = clearInvestigationFields(next);
  next = clearStaleBrokerFeeConsent(next);
  next = clearStalePolicyTypeFields(next);
  next = clearStaleElectionInitials(next);
  return next;
}

const COMMERCIAL_REPLACEMENT_FIELDS = [
  'likeForLike', 'mainDifferences', 'exclusions', 'replacementReason', 'currentInsurer', 'newInsurer',
];

/** Commercial-only: clears Replacement-of-Existing-Policy children once the answer is not 'yes'. */
export function clearStaleReplacementFields(formData) {
  if (!formData || formData.replacingExisting === 'yes') return formData;
  const patch = {};
  let changed = false;
  COMMERCIAL_REPLACEMENT_FIELDS.forEach((k) => {
    if (formData[k]) {
      patch[k] = '';
      changed = true;
    }
  });
  return changed ? { ...formData, ...patch } : formData;
}
