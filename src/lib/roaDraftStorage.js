// Shared Personal + Commercial draft-persistence service (Phase 3, sections 5 & 11).
//
// Replaces the old flow-specific sessionStorage code that used to live directly inside
// AdviceRecord.jsx (Personal only — Commercial had no draft persistence at all).
//
// Design notes:
//   - Separate sessionStorage keys per flow — a Personal draft can never collide with, or
//     be mistaken for, a Commercial draft (or vice versa).
//   - Each draft is wrapped with { schemaVersion, flowType, savedAt, currentStep, formData }.
//   - Signature images, submission status, email results, CRM retry state, DocuSign envelope
//     data and secrets/tokens are never persisted — see `sanitiseDraftFormData`. Those all
//     live in component state, not formData, so in practice this only ever has to strip
//     clientSig/advisorSig.
//   - A draft older than TTL_MS is never restored and is deleted as soon as it is found —
//     we do not keep expired personal information sitting in storage indefinitely.
//   - All sessionStorage access is wrapped in try/catch: private browsing, quota errors or
//     storage being disabled must never throw or break the wizard.

import { getInitialFormData, applyConditionalCleanup as applyPersonalCleanup } from './hrsConstants';
import { getCommercialInitialFormData, applyConditionalCleanup as applyCommercialCleanup } from './hrsCommercialConstants';

export const DRAFT_SCHEMA_VERSION = 2;
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const LEGACY_PERSONAL_KEY = 'hrs_roa_draft';

const KEYS = {
  personal: 'hrs_roa_draft_personal',
  commercial: 'hrs_roa_draft_commercial',
};

// Never persisted, regardless of what the caller passes in.
const EXCLUDED_FIELDS = [
  'clientSig', 'advisorSig', 'sigDate', 'perilsSelected', 'perilsOther',
  'valueToBeInsured', 'compulsoryExcess', 'voluntaryExcess', 'noClaimsBonus',
];

// Curated "did the user actually start entering something" fields, used only to decide
// whether a beforeunload warning is warranted (the initial form shape already carries
// several non-empty default strings — e.g. clientNeeds — so a deep-equality check against
// the initial shape would be too noisy).
const IDENTITY_FIELDS = {
  personal: ['firstName', 'surname', 'idNumber', 'email', 'cell'],
  commercial: ['companyName', 'registrationNo', 'contactFirstName', 'contactSurname', 'email'],
};

// Amendments (Issue #8) keep their drafts under a separate key per revision being replaced,
// so an amendment draft can never overwrite — or be restored into — a brand-new ROA draft
// (or another amendment's). `scope` is the submission id being amended.
const AMEND_SCOPE = /^ROA-[0-9a-fA-F-]{36}$/;

function keyFor(flowType, scope) {
  const key = KEYS[flowType];
  if (!key) throw new Error(`Unknown ROA flow type: ${flowType}`);
  if (scope === undefined || scope === null) return key;
  if (typeof scope !== 'string' || !AMEND_SCOPE.test(scope)) {
    throw new Error('Invalid ROA draft scope');
  }
  return `${key}__amend__${scope}`;
}

function readRaw(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function removeKey(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore — storage unavailable
  }
}

/** Strips signature images (and anything else that must never be persisted) from formData. */
export function sanitiseDraftFormData(formData) {
  if (!formData || typeof formData !== 'object') return formData;
  const clean = { ...formData };
  EXCLUDED_FIELDS.forEach((k) => {
    delete clean[k];
  });
  return clean;
}

/** Saves { currentStep, formData } for the given flow (and amendment scope). Never throws. */
export function saveRoaDraft(flowType, { currentStep, formData }, scope) {
  try {
    const wrapper = {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      flowType,
      savedAt: new Date().toISOString(),
      currentStep,
      formData: sanitiseDraftFormData(formData),
    };
    sessionStorage.setItem(keyFor(flowType, scope), JSON.stringify(wrapper));
  } catch {
    // sessionStorage unavailable (private browsing, quota exceeded, storage disabled) —
    // drafts are a convenience feature, so fail silently rather than breaking the wizard.
  }
}

/** True if the wrapped draft is older than the 24-hour TTL (or has no usable savedAt). */
export function isRoaDraftExpired(draft) {
  if (!draft?.savedAt) return true;
  const savedAt = new Date(draft.savedAt).getTime();
  if (!Number.isFinite(savedAt)) return true;
  return Date.now() - savedAt > DRAFT_TTL_MS;
}

/** Removes the draft for one flow (and scope) only — never touches any other key. */
export function clearRoaDraft(flowType, scope) {
  try {
    removeKey(keyFor(flowType, scope));
  } catch {
    // an invalid scope has no draft to remove
  }
}

/**
 * Merges stored/frozen form data into the CURRENT initial shape for the flow: unknown or
 * deprecated keys are dropped, new fields take today's defaults, and the conditional-cleanup
 * invariants are re-applied. Shared by draft restore and by amendment prefill.
 */
export function normaliseFormData(flowType, rawFormData) {
  const initial = flowType === 'commercial' ? getCommercialInitialFormData() : getInitialFormData();
  const applyCleanup = flowType === 'commercial' ? applyCommercialCleanup : applyPersonalCleanup;
  const source = rawFormData && typeof rawFormData === 'object' ? rawFormData : {};
  const merged = { ...initial };

  Object.keys(initial).forEach((key) => {
    if (!(key in source)) return; // drop unknown/deprecated — nothing to merge in
    const initialVal = initial[key];
    const incoming = source[key];
    if (typeof initialVal === 'boolean') {
      merged[key] = Boolean(incoming);
    } else if (Array.isArray(initialVal)) {
      merged[key] = Array.isArray(incoming) ? incoming : initialVal;
    } else {
      merged[key] = incoming ?? initialVal;
    }
  });

  // Re-apply conditional-cleanup invariants so stale legacy child values (e.g. an
  // acknowledged Letter of Investigation saved while changingBroker was 'yes', restored
  // after the schema or the answer has since changed) cannot reappear.
  return applyCleanup(merged);
}

function looksLikePersonalFormShape(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const hasPersonalFields = 'firstName' in obj || 'surname' in obj || 'idNumber' in obj;
  const hasCommercialFields = 'companyName' in obj || 'registrationNo' in obj;
  return hasPersonalFields && !hasCommercialFields;
}

/**
 * One-time migration of the old, Personal-only, unwrapped sessionStorage key into the new
 * per-flow wrapped schema. No-ops for Commercial (the legacy key was never Commercial data).
 */
function migrateLegacyPersonalDraft() {
  if (readRaw(keyFor('personal'))) {
    // A current-schema Personal draft already exists — the legacy key is redundant.
    removeKey(LEGACY_PERSONAL_KEY);
    return;
  }

  let legacyRaw;
  try {
    const raw = sessionStorage.getItem(LEGACY_PERSONAL_KEY);
    legacyRaw = raw ? JSON.parse(raw) : null;
  } catch {
    legacyRaw = null;
  }
  if (!legacyRaw) return;

  if (!looksLikePersonalFormShape(legacyRaw)) {
    // Ambiguous or malformed — discard rather than guess at migration.
    removeKey(LEGACY_PERSONAL_KEY);
    return;
  }

  const wrapper = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    flowType: 'personal',
    savedAt: new Date().toISOString(),
    currentStep: 0,
    formData: sanitiseDraftFormData(legacyRaw),
  };
  try {
    sessionStorage.setItem(keyFor('personal'), JSON.stringify(wrapper));
    removeKey(LEGACY_PERSONAL_KEY);
  } catch {
    // Could not write the new key — leave the legacy key in place rather than losing data.
  }
}

/**
 * Returns { status: 'none' | 'valid' | 'expired', draft }.
 * An 'expired' draft has already been deleted from storage by the time this returns.
 */
export function getDraftStatus(flowType, scope) {
  // The one-time legacy migration only ever concerned the un-scoped Personal draft.
  if (flowType === 'personal' && (scope === undefined || scope === null)) migrateLegacyPersonalDraft();

  let key;
  try {
    key = keyFor(flowType, scope);
  } catch {
    return { status: 'none', draft: null };
  }
  const raw = readRaw(key);
  if (!raw) return { status: 'none', draft: null };

  if (isRoaDraftExpired(raw)) {
    clearRoaDraft(flowType, scope);
    return { status: 'expired', draft: null };
  }

  return {
    status: 'valid',
    draft: {
      ...raw,
      formData: normaliseFormData(flowType, raw.formData),
    },
  };
}

/** Convenience wrapper — returns the usable draft (already normalised), or null. */
export function readRoaDraft(flowType, scope) {
  return getDraftStatus(flowType, scope).draft;
}

/** Whether there's enough real client/company data entered to justify a beforeunload warning. */
export function hasMeaningfulDraftData(flowType, formData) {
  if (!formData) return false;
  const fields = IDENTITY_FIELDS[flowType] || [];
  return fields.some((k) => String(formData[k] ?? '').trim().length > 0);
}
