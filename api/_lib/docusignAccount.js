// Resolve the DocuSign eSignature REST base URI for the configured account
// (Phase ROA-0.1).
//
// DocuSign production accounts are hosted on account-specific shards
// (na1 … na4, eu1, au1, etc.) — hard-coding 'na4' was wrong for accounts not
// hosted there and caused signed envelopes to be rejected by DocuSign with a
// misleading "account not found" error. The authoritative source is the
// UserInfo response for the JWT bearer, keyed by the configured
// DOCUSIGN_ACCOUNT_ID.
//
// Contract:
//   • Return `${accounts[i].base_uri}/restapi` for the entry whose
//     `account_id` matches DOCUSIGN_ACCOUNT_ID.
//   • Throw on: unreachable/non-2xx UserInfo, malformed response, missing
//     accounts array, no matching account, malformed base_uri.
//
// A `fetchImpl` seam is exposed so tests can inject a mock and never make a
// real DocuSign network call.

const USERINFO_PATH = '/oauth/userinfo';

/**
 * @param {object} args
 * @param {string} args.authServer  e.g. 'account-d.docusign.com' | 'account.docusign.com'
 * @param {string} args.accessToken JWT access token from getJWTAccessToken()
 * @param {string} args.accountId   DOCUSIGN_ACCOUNT_ID (GUID) — must appear in UserInfo.accounts
 * @param {typeof fetch} [fetchImpl] injectable fetch (for tests); defaults to global fetch
 * @returns {Promise<{ baseUrl: string, accountName?: string }>}
 */
export async function resolveDocusignAccountBaseUrl(
  { authServer, accessToken, accountId },
  fetchImpl,
) {
  if (!authServer) throw new Error('resolveDocusignAccountBaseUrl: authServer is required');
  if (!accessToken) throw new Error('resolveDocusignAccountBaseUrl: accessToken is required');
  if (!accountId) throw new Error('resolveDocusignAccountBaseUrl: accountId is required');

  const f = fetchImpl || fetch;
  const url = `https://${authServer}${USERINFO_PATH}`;

  let response;
  try {
    response = await f(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new Error(`DocuSign UserInfo request failed: ${err?.message || err}`);
  }

  if (!response.ok) {
    throw new Error(`DocuSign UserInfo request returned HTTP ${response.status}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('DocuSign UserInfo response was not valid JSON');
  }

  if (!data || !Array.isArray(data.accounts)) {
    throw new Error('DocuSign UserInfo response is missing the "accounts" array');
  }

  const match = data.accounts.find((a) => a && a.account_id === accountId);
  if (!match) {
    throw new Error(
      `Configured DocuSign account ${accountId} was not found in the authenticated user's UserInfo response`,
    );
  }

  const baseUri = typeof match.base_uri === 'string' ? match.base_uri.trim() : '';
  if (!/^https?:\/\/[^\s]+$/i.test(baseUri)) {
    throw new Error(
      `DocuSign account ${accountId} returned a malformed base_uri: ${JSON.stringify(match.base_uri)}`,
    );
  }

  return {
    baseUrl: `${baseUri.replace(/\/+$/, '')}/restapi`,
    accountName: typeof match.account_name === 'string' ? match.account_name : undefined,
  };
}
