// Recommended-insurer auto-link (Personal + Commercial "Products & Advice").
//
// Option 3 (`ins2`) is the explicitly recommended option, so the separate
// "Recommended Insurer" field (`recInsurer`) is pre-filled from it. The premium
// has a single source of truth (`prem2`); only the insurer label is mirrored.
//
// "Linked" is derived from the data itself instead of a persisted flag, so it
// survives draft restore and never needs a migration: `recInsurer` follows
// `ins2` while it is blank or still equal to the current `ins2`. As soon as the
// broker types something different it is a deliberate override and is never
// overwritten again. Clearing the field (or making it equal to `ins2` again)
// re-links it.

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export function isRecommendedInsurerLinked(data) {
  const rec = trimmed(data?.recInsurer);
  return rec === '' || rec === trimmed(data?.ins2);
}

/** Returns the next form data after the Option 3 insurer/product changes. */
export function applyOption3Insurer(data, nextIns2) {
  const next = { ...data, ins2: nextIns2 };
  if (isRecommendedInsurerLinked(data)) next.recInsurer = nextIns2;
  return next;
}
