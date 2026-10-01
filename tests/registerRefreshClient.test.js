import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/apiAuth.js', () => ({
  authHeader: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

const {
  loadSubmissionRegister,
  refreshSubmissionRegister,
} = await import('../src/lib/roaSubmissionClient.js');

function jsonResponse(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

describe('My ROAs reconciliation order', () => {
  let calls;

  beforeEach(() => {
    calls = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/roa-submissions/reconcile-pending') return jsonResponse({ ok: true });
      return jsonResponse({ submissions: [{ submissionId: 'ROA-fresh', status: 'completed' }] });
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('manual Refresh reconciles pending signing state before re-listing', async () => {
    const items = await refreshSubmissionRegister();
    expect(calls.map((call) => call.url)).toEqual([
      '/api/roa-submissions/reconcile-pending',
      '/api/roa-submissions/list',
    ]);
    expect(items[0].submissionId).toBe('ROA-fresh');
    calls.forEach((call) => expect(call.options.cache).toBe('no-store'));
  });

  it('initial load only reconciles after discovering a pending record, then re-lists', async () => {
    let listCount = 0;
    global.fetch.mockImplementation(async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/roa-submissions/reconcile-pending') return jsonResponse({ ok: true });
      listCount += 1;
      return jsonResponse({ submissions: listCount === 1 ? [{
        submissionId: 'ROA-pending',
        status: 'awaiting_signature',
        signingProvider: 'documenso',
        signingEnvelopeId: 'env-1',
      }] : [{ submissionId: 'ROA-pending', status: 'completed' }] });
    });
    await loadSubmissionRegister();
    expect(calls.map((call) => call.url)).toEqual([
      '/api/roa-submissions/list',
      '/api/roa-submissions/reconcile-pending',
      '/api/roa-submissions/list',
    ]);
  });
});
