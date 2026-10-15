// Structurally valid but UNSIGNED access tokens for offline tests.
//
// api/_lib/auth.js rejects anything that is not shaped like a Supabase access
// token (three base64url segments, matching issuer / audience / role, an unexpired
// exp) before it asks the Auth service. Real signature verification is the Auth
// service's job and is mocked in these tests (`auth.getUser`), so the signature
// segment here is a placeholder. NEVER treat these as proof a token is valid.

export const TEST_AUTH_URL = 'https://project.supabase.co';
export const TEST_ISSUER = `${TEST_AUTH_URL}/auth/v1`;
const FAR_FUTURE_EXP = 4102444800; // 2100-01-01T00:00:00Z

function segment(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * @param {object} [options]
 * @param {string} [options.sub]
 * @param {string} [options.iss]
 * @param {string|string[]} [options.aud]
 * @param {string} [options.role]
 * @param {number} [options.exp] seconds since epoch
 * @param {string} [options.alg]
 * @param {string} [options.signature]
 * @param {object} [options.claims] extra claims
 * @param {string[]} [options.omit] claim names to leave out entirely
 */
export function makeTestJwt({
  sub = 'user-test',
  iss = TEST_ISSUER,
  aud = 'authenticated',
  role = 'authenticated',
  exp = FAR_FUTURE_EXP,
  alg = 'HS256',
  signature = 'c2lnbmF0dXJlLXBsYWNlaG9sZGVy',
  claims = {},
  omit = [],
} = {}) {
  const header = segment({ alg, typ: 'JWT' });
  const payload = { iss, aud, role, sub, exp, iat: exp - 3600, ...claims };
  for (const name of omit) delete payload[name];
  return `${header}.${segment(payload)}.${signature}`;
}

/** Deterministic per-broker tokens matching the fixture user ids used across the suite. */
export const TEST_TOKENS = Object.freeze({
  andrew: makeTestJwt({ sub: 'user-andrew' }),
  werner: makeTestJwt({ sub: 'user-werner' }),
  stranger: makeTestJwt({ sub: 'user-stranger' }),
});
