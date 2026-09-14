// Authoritative broker → email directory (Phase ROA-0).
//
// Extracted from hrsConstants.js so serverless endpoints can import a pure-data
// module without pulling in the whole wizard-config surface. hrsConstants.js
// re-exports these values so all existing imports continue to work unchanged.
//
// Never inline a broker email in the client or in an API endpoint again — import
// from here (or via hrsConstants for existing client code) and let the two sides
// stay locked to the same table.

export const BROKER_EMAIL_MAP = {
  'Aedan Doubell':        'aedan@hrsinsurance.co.za',
  'Andrew Penney':        'andrew@hrsinsurance.co.za',
  'Charmaine Brogden':    'charmaine@hrsinsurance.co.za',
  'Daniel Pottier':       'daniel@hrsinsurance.co.za',
  'Jaryd Browne':         'jaryd@hrsinsurance.co.za',
  'Juan-Paul vd Merwe':   'juan-paul@hrsinsurance.co.za',
  'Werner Joubert':       'werner@hrsinsurance.co.za',
  'Brian Hodges':         'brian@hrsinsurance.co.za',
  'Faizel Patel':         'faizel@hrsinsurance.co.za',
};

// Preserved original casing to stay behaviour-compatible with existing client
// lookups (e.g. AdviceRecord.jsx uses `user.email` verbatim). Case-insensitive
// checks belong in `isHrsBrokerEmail` instead.
export const EMAIL_TO_BROKER = Object.fromEntries(
  Object.entries(BROKER_EMAIL_MAP).map(([name, email]) => [email, name])
);

const BROKER_EMAIL_LOOKUP = new Set(
  Object.values(BROKER_EMAIL_MAP).map((email) => email.toLowerCase())
);

export const DEFAULT_BROKER_EMAIL = 'info@hrsinsurance.co.za';
export const MANAGER_NAME = 'Andrew Penney';

export const ADVISORS = Object.keys(BROKER_EMAIL_MAP);

/** True if `email` is a known HRS broker mailbox (case-insensitive). */
export function isHrsBrokerEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return BROKER_EMAIL_LOOKUP.has(email.toLowerCase());
}
