import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncPersonalROAToCRM } from '../src/lib/crmSync.js';

const session = { access_token: 'token-123' };

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('syncPersonalROAToCRM — success path', () => {
  it('creates a client and a deal when no duplicate exists', async () => {
    const calls = [];
    global.fetch = vi.fn(async (url) => {
      calls.push(url);
      if (String(url).includes('clients-check-duplicate')) return jsonResponse({ duplicates: [] });
      if (String(url).includes('/clients?action=create')) return jsonResponse({ id: 'client-1' });
      if (String(url).includes('/deals?action=create')) return jsonResponse({ id: 'deal-1' });
      throw new Error('unexpected url ' + url);
    });

    const result = await syncPersonalROAToCRM({ firstName: 'Jane', surname: 'Doe', idNumber: '123', email: 'jane@example.com' }, session);

    expect(result.success).toBe(true);
    expect(result.clientId).toBe('client-1');
    expect(result.dealId).toBe('deal-1');
    expect(calls.length).toBe(3);
  });
});

describe('syncPersonalROAToCRM — failure and retry', () => {
  it('reports a user-safe failure without exposing raw server errors', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('clients-check-duplicate')) return jsonResponse({ duplicates: [] });
      if (String(url).includes('/clients?action=create')) return jsonResponse({ error: 'internal secret detail xyz' }, false, 500);
      throw new Error('unexpected url ' + url);
    });

    const result = await syncPersonalROAToCRM({ firstName: 'Jane' }, session);

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('xyz');
    expect(result.errorCode).toBe('client_create_failed');
  });

  it('retry reuses an already-created clientId instead of creating a second client', async () => {
    const clientCreateCalls = [];
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('clients-check-duplicate')) return jsonResponse({ duplicates: [] });
      if (String(url).includes('/clients?action=create')) {
        clientCreateCalls.push(1);
        return jsonResponse({ id: 'client-1' });
      }
      if (String(url).includes('/deals?action=create')) {
        // First attempt fails, second (retry) succeeds
        if (clientCreateCalls.length === 1 && !global.__dealAttempted) {
          global.__dealAttempted = true;
          return jsonResponse({ error: 'deal rejected' }, false, 500);
        }
        return jsonResponse({ id: 'deal-1' });
      }
      throw new Error('unexpected url ' + url);
    });

    const first = await syncPersonalROAToCRM({ firstName: 'Jane' }, session);
    expect(first.success).toBe(false);
    expect(first.clientId).toBe('client-1'); // preserved even though deal failed

    const retry = await syncPersonalROAToCRM({ firstName: 'Jane' }, session, { clientId: first.clientId });
    expect(retry.success).toBe(true);
    expect(retry.clientId).toBe('client-1');
    expect(clientCreateCalls.length).toBe(1); // client was not re-created on retry
    delete global.__dealAttempted;
  });

  it('short-circuits entirely when an existing dealId is already known (no duplicate risk)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('fetch should not be called when existing.dealId is already known');
    });

    const result = await syncPersonalROAToCRM({ firstName: 'Jane' }, session, { clientId: 'client-1', dealId: 'deal-1' });

    expect(result).toEqual({ success: true, clientId: 'client-1', dealId: 'deal-1' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
