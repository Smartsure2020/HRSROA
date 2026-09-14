// Account-specific DocuSign base URI resolution (Phase ROA-0.1).
//
// Confirms:
//   • Sandbox account resolves to its own base URI (whatever the demo shard
//     returns — the test does not hard-code a value beyond the mock).
//   • Production account resolves to the shard the account is actually on —
//     including shards other than na4 (na2 in this fixture) — because the
//     old hard-coded 'na4' assumption is what the review flagged.
//   • Configured account not present in UserInfo → throws (never falls back).
//   • Malformed UserInfo (missing accounts array / malformed base_uri) →
//     throws.
//   • Non-2xx UserInfo → throws.
//   • Network error → throws.
//   • No real DocuSign call is made — a fetchImpl is injected.

import { describe, expect, it, vi } from 'vitest';
import { resolveDocusignAccountBaseUrl } from '../api/_lib/docusignAccount.js';

const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555';

function mockFetchWithJson(body, { ok = true, status = ok ? 200 : 500, textFallback } = {}) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => {
      if (textFallback !== undefined) throw new Error('not json');
      return body;
    },
  }));
}

describe('resolveDocusignAccountBaseUrl', () => {
  it('resolves the sandbox account base URI from UserInfo', async () => {
    const fetchImpl = mockFetchWithJson({
      accounts: [
        {
          account_id: ACCOUNT_ID,
          account_name: 'HRS Sandbox',
          base_uri: 'https://demo.docusign.net',
        },
      ],
    });
    const result = await resolveDocusignAccountBaseUrl(
      { authServer: 'account-d.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
      fetchImpl,
    );
    expect(result.baseUrl).toBe('https://demo.docusign.net/restapi');
    expect(result.accountName).toBe('HRS Sandbox');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe('https://account-d.docusign.com/oauth/userinfo');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('resolves a production account hosted on na2 (NOT na4)', async () => {
    const fetchImpl = mockFetchWithJson({
      accounts: [
        { account_id: 'other-account', base_uri: 'https://na1.docusign.net' },
        { account_id: ACCOUNT_ID, account_name: 'HRS Live', base_uri: 'https://na2.docusign.net' },
      ],
    });
    const result = await resolveDocusignAccountBaseUrl(
      { authServer: 'account.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
      fetchImpl,
    );
    expect(result.baseUrl).toBe('https://na2.docusign.net/restapi');
  });

  it('resolves an account hosted outside the na cluster (eu1)', async () => {
    const fetchImpl = mockFetchWithJson({
      accounts: [{ account_id: ACCOUNT_ID, base_uri: 'https://eu1.docusign.net' }],
    });
    const result = await resolveDocusignAccountBaseUrl(
      { authServer: 'account.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
      fetchImpl,
    );
    expect(result.baseUrl).toBe('https://eu1.docusign.net/restapi');
  });

  it('trims a trailing slash on base_uri before appending /restapi', async () => {
    const fetchImpl = mockFetchWithJson({
      accounts: [{ account_id: ACCOUNT_ID, base_uri: 'https://na3.docusign.net/' }],
    });
    const result = await resolveDocusignAccountBaseUrl(
      { authServer: 'account.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
      fetchImpl,
    );
    expect(result.baseUrl).toBe('https://na3.docusign.net/restapi');
  });

  it('throws when the configured account is not in the UserInfo response', async () => {
    const fetchImpl = mockFetchWithJson({
      accounts: [{ account_id: 'a-different-account', base_uri: 'https://na1.docusign.net' }],
    });
    await expect(
      resolveDocusignAccountBaseUrl(
        { authServer: 'account.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
        fetchImpl,
      ),
    ).rejects.toThrow(/was not found/);
  });

  it('throws when UserInfo returns HTTP 401', async () => {
    const fetchImpl = mockFetchWithJson({}, { ok: false, status: 401 });
    await expect(
      resolveDocusignAccountBaseUrl(
        { authServer: 'account.docusign.com', accessToken: 'bad', accountId: ACCOUNT_ID },
        fetchImpl,
      ),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('throws when the accounts field is missing entirely', async () => {
    const fetchImpl = mockFetchWithJson({ sub: 'u', name: 'Broker' });
    await expect(
      resolveDocusignAccountBaseUrl(
        { authServer: 'account.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
        fetchImpl,
      ),
    ).rejects.toThrow(/missing the "accounts" array/);
  });

  it('throws when accounts[i].base_uri is malformed', async () => {
    const fetchImpl = mockFetchWithJson({
      accounts: [{ account_id: ACCOUNT_ID, base_uri: 'not-a-url' }],
    });
    await expect(
      resolveDocusignAccountBaseUrl(
        { authServer: 'account.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
        fetchImpl,
      ),
    ).rejects.toThrow(/malformed base_uri/);
  });

  it('throws when UserInfo body is not valid JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('not json'); },
    }));
    await expect(
      resolveDocusignAccountBaseUrl(
        { authServer: 'account.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
        fetchImpl,
      ),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the network layer errors', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    await expect(
      resolveDocusignAccountBaseUrl(
        { authServer: 'account.docusign.com', accessToken: 'tok', accountId: ACCOUNT_ID },
        fetchImpl,
      ),
    ).rejects.toThrow(/DocuSign UserInfo request failed/);
  });

  it('requires all three inputs — refuses to fabricate defaults', async () => {
    await expect(
      resolveDocusignAccountBaseUrl({ accessToken: 't', accountId: 'a' }, vi.fn()),
    ).rejects.toThrow(/authServer is required/);
    await expect(
      resolveDocusignAccountBaseUrl({ authServer: 's', accountId: 'a' }, vi.fn()),
    ).rejects.toThrow(/accessToken is required/);
    await expect(
      resolveDocusignAccountBaseUrl({ authServer: 's', accessToken: 't' }, vi.fn()),
    ).rejects.toThrow(/accountId is required/);
  });
});
