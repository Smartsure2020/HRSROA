// sessionStorage-backed recovery for the current post-submit view
// (Phase ROA-1 §23).
//
// After a successful create, we cache the submissionId in sessionStorage so a
// browser refresh on the Checklist screen re-hydrates from durable server
// state (via getSubmission) rather than losing the post-submit context.
//
// Only the id is cached here — never snapshot data. The authoritative record
// lives on the server; this is a UI convenience only.

const KEY_FOR = (flowType) => `hrs_roa_last_submission_${flowType}`;
const TTL_MS = 24 * 60 * 60 * 1000;

export function rememberLastSubmission(flowType, { submissionId }) {
  try {
    sessionStorage.setItem(KEY_FOR(flowType), JSON.stringify({
      submissionId,
      savedAt: new Date().toISOString(),
    }));
  } catch { /* ignore quota / private-mode errors */ }
}

export function forgetLastSubmission(flowType) {
  try { sessionStorage.removeItem(KEY_FOR(flowType)); } catch { /* ignore */ }
}

export function readLastSubmission(flowType) {
  try {
    const raw = sessionStorage.getItem(KEY_FOR(flowType));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.submissionId !== 'string') return null;
    const savedAt = new Date(parsed.savedAt).getTime();
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > TTL_MS) {
      forgetLastSubmission(flowType);
      return null;
    }
    return { submissionId: parsed.submissionId };
  } catch {
    return null;
  }
}
