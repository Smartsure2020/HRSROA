// Canonical PDF template identifier (Phase ROA-1).
//
// Stamped into every generated canonical PDF and persisted alongside the
// submission row. Bump this when the layout produced by hrsPdfGenerator.js /
// hrsCommercialPdfGenerator.js is materially altered — so a historical
// submission's stored template_version tells auditors which renderer produced
// its bytes, regardless of what the current code prints.

export const HRS_TEMPLATE_VERSION = 'HRS-TEMPLATE-2026-01';
