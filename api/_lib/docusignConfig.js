// Explicit DocuSign environment selection (Phase ROA-0).
//
// Previously the auth server and REST base URL were hard-coded to the sandbox
// with production URLs commented out. That made a production switch a code
// edit — the wrong shape for a compliance-sensitive integration.
//
// Now: DOCUSIGN_ENVIRONMENT selects between two known-good environments and
// nothing else. Missing → 'sandbox' (safe default). Unknown value → throws so
// deployment fails loudly rather than silently falling back.
//
// DocuSign endpoints published at
//   https://developers.docusign.com/platform/auth/reference-oauth2-endpoints/

const ENVIRONMENTS = Object.freeze({
  sandbox: Object.freeze({
    authServer: 'account-d.docusign.com',
    baseUrl: 'https://demo.docusign.net/restapi',
  }),
  production: Object.freeze({
    authServer: 'account.docusign.com',
    baseUrl: 'https://na4.docusign.net/restapi',
  }),
});

export const DOCUSIGN_ENVIRONMENTS = Object.freeze(Object.keys(ENVIRONMENTS));

/**
 * Resolves the DocuSign endpoint config from `DOCUSIGN_ENVIRONMENT`.
 * Accepts a value override for testing so we never read `process.env` from
 * inside unit tests.
 *
 * @param {string} [environment] override; defaults to `process.env.DOCUSIGN_ENVIRONMENT` or 'sandbox'
 * @returns {{ environment: 'sandbox'|'production', authServer: string, baseUrl: string }}
 */
export function getDocusignConfig(environment) {
  const raw = environment ?? process.env.DOCUSIGN_ENVIRONMENT ?? 'sandbox';
  const key = String(raw).trim().toLowerCase();
  const config = ENVIRONMENTS[key];
  if (!config) {
    throw new Error(
      `Unsupported DOCUSIGN_ENVIRONMENT: ${JSON.stringify(raw)} — expected one of ${DOCUSIGN_ENVIRONMENTS.join(', ')}`,
    );
  }
  return { environment: key, authServer: config.authServer, baseUrl: config.baseUrl };
}
