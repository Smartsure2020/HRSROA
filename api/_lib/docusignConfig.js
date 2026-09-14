// Explicit DocuSign auth-environment selection (Phase ROA-0.1).
//
// Selects the OAuth / auth server based on DOCUSIGN_ENVIRONMENT. Missing →
// 'sandbox' (safe default). Unknown value throws. No comment/uncomment switch,
// no silent fallback either direction.
//
// The eSignature REST base URI is NOT hard-coded here any more — DocuSign
// production accounts do not all live on the same shard (na1 / na2 / na3 /
// na4 / eu1 / etc.). The real base URI comes from the authenticated account's
// UserInfo response — see api/_lib/docusignAccount.js.
//
// DOCUSIGN_BASE_URL is available as an explicit override for the very small
// number of situations where UserInfo cannot be called (e.g. an internal test
// harness pointing at a private DocuSign proxy). When set, it bypasses the
// UserInfo lookup entirely; otherwise the authenticated account's base_uri is
// authoritative.

const AUTH_SERVERS = Object.freeze({
  sandbox: 'account-d.docusign.com',
  production: 'account.docusign.com',
});

export const DOCUSIGN_ENVIRONMENTS = Object.freeze(Object.keys(AUTH_SERVERS));

/**
 * Resolves the DocuSign auth-environment config.
 *
 * @param {string} [environment] override; defaults to `process.env.DOCUSIGN_ENVIRONMENT` or 'sandbox'
 * @returns {{ environment: 'sandbox'|'production', authServer: string }}
 */
export function getDocusignConfig(environment) {
  const raw = environment ?? process.env.DOCUSIGN_ENVIRONMENT ?? 'sandbox';
  const key = String(raw).trim().toLowerCase();
  const authServer = AUTH_SERVERS[key];
  if (!authServer) {
    throw new Error(
      `Unsupported DOCUSIGN_ENVIRONMENT: ${JSON.stringify(raw)} — expected one of ${DOCUSIGN_ENVIRONMENTS.join(', ')}`,
    );
  }
  return { environment: key, authServer };
}

/**
 * Returns the operator-supplied base URL override, or null when none is set.
 * When null, callers must resolve the account-specific base URI from
 * DocuSign's OAuth UserInfo endpoint (see resolveDocusignAccountBaseUrl).
 */
export function getConfiguredBaseUrlOverride() {
  const raw = process.env.DOCUSIGN_BASE_URL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
