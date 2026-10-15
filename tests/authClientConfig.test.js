// Browser-side authentication behaviour for the CRM-auth cutover: configuration,
// CRM→ROA handoff scrubbing, legacy-session cleanup, the ROA access probe, refresh,
// logout, and the secrecy boundary (no ROA data credentials in the browser).
// Node environment, no DOM: every collaborator is injected.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  isCrmSessionHandoffEnabled,
  resolveAuthClientConfig,
} from '../src/lib/authConfig.js';
import {
  BROKER_PROBE_PATH,
  captureHandoffFromUrl,
  probeBrokerAuthorisation,
  purgeLegacyAuthStorage,
  signOutLocal,
} from '../src/lib/authSession.js';

const CRM_URL = 'https://mgqelduyralkdbsbwqcu.supabase.co';
const ROA_URL = 'https://rylfshngbafldisqrhec.supabase.co';

describe('browser auth configuration', () => {
  it('uses the CRM project when the AUTH pair is set', () => {
    expect(resolveAuthClientConfig({
      VITE_AUTH_SUPABASE_URL: `${CRM_URL}/`,
      VITE_AUTH_SUPABASE_ANON_KEY: 'crm-anon',
      VITE_SUPABASE_URL: ROA_URL,
      VITE_SUPABASE_ANON_KEY: 'roa-anon',
    })).toEqual({
      ok: true, source: 'explicit', url: CRM_URL, anonKey: 'crm-anon', storageRef: 'mgqelduyralkdbsbwqcu',
    });
  });

  it('falls back to the legacy pair when the AUTH pair is unset (rollback path)', () => {
    expect(resolveAuthClientConfig({
      VITE_SUPABASE_URL: ROA_URL,
      VITE_SUPABASE_ANON_KEY: 'roa-anon',
    })).toMatchObject({ ok: true, source: 'legacy', url: ROA_URL, storageRef: 'rylfshngbafldisqrhec' });
  });

  it('never mixes projects: a partial AUTH pair is a configuration error', () => {
    expect(resolveAuthClientConfig({
      VITE_AUTH_SUPABASE_URL: CRM_URL,
      VITE_SUPABASE_URL: ROA_URL,
      VITE_SUPABASE_ANON_KEY: 'roa-anon',
    })).toEqual({ ok: false, error: 'auth_config_incomplete' });
    expect(resolveAuthClientConfig({
      VITE_AUTH_SUPABASE_ANON_KEY: 'crm-anon',
      VITE_SUPABASE_URL: ROA_URL,
      VITE_SUPABASE_ANON_KEY: 'roa-anon',
    })).toEqual({ ok: false, error: 'auth_config_incomplete' });
  });

  it('rejects missing, malformed and non-https URLs', () => {
    expect(resolveAuthClientConfig({})).toEqual({ ok: false, error: 'auth_config_missing' });
    expect(resolveAuthClientConfig({ VITE_AUTH_SUPABASE_URL: 'nope', VITE_AUTH_SUPABASE_ANON_KEY: 'k' }))
      .toEqual({ ok: false, error: 'auth_config_invalid_url' });
    expect(resolveAuthClientConfig({ VITE_AUTH_SUPABASE_URL: 'http://crm.example.com', VITE_AUTH_SUPABASE_ANON_KEY: 'k' }))
      .toEqual({ ok: false, error: 'auth_config_invalid_url' });
    expect(resolveAuthClientConfig({ VITE_AUTH_SUPABASE_URL: 'http://localhost:54321', VITE_AUTH_SUPABASE_ANON_KEY: 'k' }).ok)
      .toBe(true);
  });

  it('keeps the CRM→ROA token handoff OFF unless explicitly enabled', () => {
    expect(isCrmSessionHandoffEnabled({})).toBe(false);
    expect(isCrmSessionHandoffEnabled({ VITE_ENABLE_CRM_SESSION_HANDOFF: 'false' })).toBe(false);
    expect(isCrmSessionHandoffEnabled({ VITE_ENABLE_CRM_SESSION_HANDOFF: '1' })).toBe(false);
    expect(isCrmSessionHandoffEnabled({ VITE_ENABLE_CRM_SESSION_HANDOFF: 'TRUE' })).toBe(true);
  });
});

describe('CRM→ROA handoff tokens in the URL', () => {
  function fakeWindow({ pathname = '/', search = '', hash = '' } = {}) {
    return {
      location: { pathname, search, hash },
      history: { state: { idx: 1 }, replaceState: vi.fn() },
    };
  }

  it('captures the tokens and scrubs them from the address bar immediately, keeping other parameters', () => {
    const win = fakeWindow({ pathname: '/roas', search: '?access_token=AAA&refresh_token=RRR&client_id=42', hash: '#top' });
    const captured = captureHandoffFromUrl(win);

    expect(captured).toEqual({ accessToken: 'AAA', refreshToken: 'RRR' });
    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    expect(win.history.replaceState).toHaveBeenCalledWith({ idx: 1 }, '', '/roas?client_id=42#top');
    const rewritten = win.history.replaceState.mock.calls[0][2];
    expect(rewritten).not.toContain('AAA');
    expect(rewritten).not.toContain('RRR');
  });

  it('scrubs a partial / unusable pair too, and returns nothing to act on', () => {
    const win = fakeWindow({ search: '?access_token=AAA' });
    expect(captureHandoffFromUrl(win)).toBeNull();
    expect(win.history.replaceState).toHaveBeenCalledWith({ idx: 1 }, '', '/');
  });

  it('leaves an ordinary URL alone', () => {
    const win = fakeWindow({ pathname: '/personal', search: '?client_id=42' });
    expect(captureHandoffFromUrl(win)).toBeNull();
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });

  it('is safe without a browser', () => {
    expect(captureHandoffFromUrl(undefined)).toBeNull();
    expect(captureHandoffFromUrl({})).toBeNull();
  });
});

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    keys: () => Array.from(map.keys()).sort(),
  };
}

describe('legacy ROA-project session cleanup', () => {
  it('removes only sessions that belong to a different Supabase project', () => {
    const storage = memoryStorage({
      'sb-rylfshngbafldisqrhec-auth-token': '{"refresh_token":"old-roa"}',
      'sb-rylfshngbafldisqrhec-auth-token-code-verifier': 'verifier',
      'sb-mgqelduyralkdbsbwqcu-auth-token': '{"refresh_token":"crm"}',
      hrs_roa_draft_personal: '{"firstName":"Jane"}',
      'unrelated-sb-key': 'x',
    });

    const removed = purgeLegacyAuthStorage(storage, 'mgqelduyralkdbsbwqcu');

    expect(removed.sort()).toEqual([
      'sb-rylfshngbafldisqrhec-auth-token',
      'sb-rylfshngbafldisqrhec-auth-token-code-verifier',
    ]);
    expect(storage.keys()).toEqual([
      'hrs_roa_draft_personal', 'sb-mgqelduyralkdbsbwqcu-auth-token', 'unrelated-sb-key',
    ]);
  });

  it('is a no-op for missing or failing storage', () => {
    expect(purgeLegacyAuthStorage(null, 'x')).toEqual([]);
    expect(purgeLegacyAuthStorage(memoryStorage(), '')).toEqual([]);
    const hostile = {
      length: 1,
      key: () => 'sb-old-auth-token',
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(purgeLegacyAuthStorage(hostile, 'new')).toEqual([]);
  });
});

describe('ROA access probe (a CRM session alone is not enough)', () => {
  const respond = (status, body) => vi.fn(async () => ({ status, json: async () => body }));

  it('is authorised only on 200 with a broker', async () => {
    const fetchImpl = respond(200, { ok: true, broker: { name: 'Andrew Penney', email: 'andrew@hrsinsurance.co.za' } });
    const verdict = await probeBrokerAuthorisation('tok', fetchImpl);

    expect(verdict).toEqual({ status: 'authorised', broker: { name: 'Andrew Penney', email: 'andrew@hrsinsurance.co.za' } });
    expect(fetchImpl).toHaveBeenCalledWith(BROKER_PROBE_PATH, expect.objectContaining({
      headers: { Authorization: 'Bearer tok' }, cache: 'no-store',
    }));
  });

  it('denies a valid CRM user the API refuses (403)', async () => {
    expect(await probeBrokerAuthorisation('tok', respond(403, { error: 'not_an_hrs_broker' })))
      .toEqual({ status: 'denied', code: 'not_an_hrs_broker' });
  });

  it('treats 401 as an invalid/expired/foreign session', async () => {
    expect(await probeBrokerAuthorisation('tok', respond(401, { error: 'invalid_token' })))
      .toEqual({ status: 'unauthenticated', code: 'invalid_token' });
  });

  it('never authorises on anything ambiguous', async () => {
    expect((await probeBrokerAuthorisation('tok', respond(200, { ok: true }))).status).toBe('error');
    expect((await probeBrokerAuthorisation('tok', respond(200, '<html>'))).status).toBe('error');
    expect((await probeBrokerAuthorisation('tok', respond(500, { error: 'boom' }))).status).toBe('error');
    expect((await probeBrokerAuthorisation('tok', vi.fn(async () => { throw new Error('offline'); }))).status).toBe('error');
    const notJson = vi.fn(async () => ({ status: 200, json: async () => { throw new Error('bad json'); } }));
    expect((await probeBrokerAuthorisation('tok', notJson)).status).toBe('error');
  });
});

describe('logout', () => {
  it('ends only this browser session (local scope), not the broker\'s CRM sessions elsewhere', async () => {
    const client = { auth: { signOut: vi.fn(async () => ({ error: null })) } };
    const storage = memoryStorage({ 'sb-mgqelduyralkdbsbwqcu-auth-token': '{}' });

    const outcome = await signOutLocal(client, { storage, storageRef: 'mgqelduyralkdbsbwqcu' });

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(outcome).toEqual({ revoked: true });
  });

  it.each([
    ['returns an error', { auth: { signOut: vi.fn(async () => ({ error: new Error('network') })) } }],
    ['throws', { auth: { signOut: vi.fn(async () => { throw new Error('network'); }) } }],
  ])('still clears the stored session when the server call %s', async (_label, client) => {
    const storage = memoryStorage({
      'sb-mgqelduyralkdbsbwqcu-auth-token': '{"refresh_token":"r"}',
      hrs_roa_draft_personal: '{}',
    });

    const outcome = await signOutLocal(client, { storage, storageRef: 'mgqelduyralkdbsbwqcu' });

    expect(outcome).toEqual({ revoked: false });
    expect(storage.getItem('sb-mgqelduyralkdbsbwqcu-auth-token')).toBeNull();
    expect(storage.getItem('hrs_roa_draft_personal')).toBe('{}'); // unrelated data untouched
  });
});

describe('session refresh reaches the API', () => {
  it('reads the CURRENT session for every request, so a refreshed token is the one sent', async () => {
    vi.resetModules();
    const sessions = [
      { data: { session: { access_token: 'token-before-refresh' } }, error: null },
      { data: { session: { access_token: 'token-after-refresh' } }, error: null },
      { data: { session: null }, error: null },
    ];
    vi.doMock('../src/lib/supabaseClient.js', () => ({
      supabase: { auth: { getSession: vi.fn(async () => sessions.shift()) } },
    }));
    const { authHeader, getAccessTokenOrThrow } = await import('../src/lib/apiAuth.js');

    expect(await authHeader()).toEqual({ Authorization: 'Bearer token-before-refresh' });
    expect(await authHeader()).toEqual({ Authorization: 'Bearer token-after-refresh' });
    // Signed out / expired and unrecoverable: fail fast in the browser, no request is made.
    await expect(getAccessTokenOrThrow()).rejects.toThrow('Not signed in.');
    vi.doUnmock('../src/lib/supabaseClient.js');
  });
});

describe('secrecy boundary: the browser holds no ROA data credentials', () => {
  const root = new URL('../', import.meta.url);

  function sourceFiles(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(js|jsx)$/.test(name)) out.push(full);
    }
    return out;
  }
  const clientFiles = sourceFiles(fileURLToPath(new URL('src/', root)));

  // Full-line and block comments may legitimately describe what must NOT be here.
  const code = (file) => readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('no browser source references a service-role key or a ROA_* server variable', () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    for (const file of clientFiles) {
      const source = code(file);
      expect(source, file).not.toMatch(/service[_-]?role/i);
      expect(source, file).not.toMatch(/ROA_SUPABASE/);
      expect(source, file).not.toMatch(/SUPABASE_SERVICE/);
    }
  });

  it('the browser never queries the ROA database or storage directly', () => {
    for (const file of clientFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/supabase\s*\.\s*from\s*\(/);
      expect(source, file).not.toMatch(/supabase\s*\.\s*storage/);
      expect(source, file).not.toMatch(/\.rpc\s*\(/);
    }
  });

  it('the only Supabase client in the browser is the auth client built from authConfig', () => {
    const creators = clientFiles.filter((file) => /createClient\s*\(/.test(readFileSync(file, 'utf8')));
    expect(creators.map((f) => f.replace(/\\/g, '/').split('/src/')[1])).toEqual(['lib/supabaseClient.js']);
    const client = readFileSync(new URL('src/lib/supabaseClient.js', root), 'utf8');
    expect(client).toContain('resolveAuthClientConfig');
    // It delegates all env handling to authConfig rather than reading variables itself.
    expect(client).not.toContain('import.meta.env');
  });

  it('.env.example documents the new variables without any service-role value', () => {
    const example = readFileSync(new URL('.env.example', root), 'utf8');
    expect(example).toContain('VITE_AUTH_SUPABASE_URL');
    expect(example).toContain('VITE_AUTH_SUPABASE_ANON_KEY');
    expect(example).toContain('AUTH_SUPABASE_URL');
    expect(example).toContain('ROA_SUPABASE_SERVICE_ROLE_KEY');
    expect(example).not.toMatch(/VITE_[A-Z_]*SERVICE/);
    expect(example).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // no real JWT-looking secrets
  });
});
