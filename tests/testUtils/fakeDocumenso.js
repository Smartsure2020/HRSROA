// Stateful in-memory fake of the Documenso v2 REST surface this app uses.
//
// It exists so the amendment tests can script races and partial failures realistically
// (a signer completing mid-cancel, a delete that "succeeds" but leaves the envelope live,
// a crash after the provider acted) instead of hand-ordering a queue of canned responses.
// It models the behaviour documented by the vendor for the calls the app makes:
//   * POST /envelope/delete withdraws an envelope; afterwards GET /envelope/:id is 404;
//   * a signer completing an envelope turns its status COMPLETED;
// and nothing else. Whether the REAL service behaves identically (notably around a
// delete racing a completion) is a staging acceptance item, not something this proves.

const PDF = (label) => Buffer.from(`%PDF-1.4\n${label}\n${'x'.repeat(600)}\n%%EOF`, 'utf8');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function pdfResponse(bytes) {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

export function makeFakeDocumenso() {
  const envelopes = new Map();
  const calls = [];
  const overrides = [];
  let counter = 0;

  const publicView = (env) => ({
    id: env.id,
    status: env.status,
    externalId: env.externalId,
    completedAt: env.completedAt || null,
    recipients: env.recipients.map((r) => ({ ...r })),
    envelopeItems: env.envelopeItems.map((i) => ({ ...i })),
    fields: env.fields.map((f) => ({ ...f })),
  });

  function newRecipients() {
    return [
      { id: 101, email: 'client@example.test', name: 'Client', role: 'SIGNER', signingOrder: 1, signingStatus: 'NOT_SIGNED' },
      { id: 102, email: 'broker@example.test', name: 'Broker', role: 'SIGNER', signingOrder: 2, signingStatus: 'NOT_SIGNED' },
    ];
  }

  function seedEnvelope({
    id = `env-seed-${++counter}`,
    externalId,
    status = 'PENDING',
    recipients = newRecipients(),
  } = {}) {
    const env = {
      id,
      externalId,
      status,
      completedAt: status === 'COMPLETED' ? '2026-10-01T10:00:00.000Z' : null,
      recipients,
      envelopeItems: [{ id: `item-${id}` }],
      fields: [{ type: 'SIGNATURE' }, { type: 'DATE' }, { type: 'SIGNATURE' }, { type: 'DATE' }],
      deleted: false,
    };
    envelopes.set(id, env);
    return env;
  }

  async function fetchImpl(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const parsed = new URL(String(url));
    const path = parsed.pathname.replace(/^\/api\/v2/, '');
    let body = null;
    if (typeof options.body === 'string') {
      try { body = JSON.parse(options.body); } catch { body = null; }
    } else if (options.body && typeof options.body.get === 'function') {
      try { body = JSON.parse(options.body.get('payload')); } catch { body = null; }
    }
    const call = { method, path, search: parsed.search, body };
    calls.push(call);

    for (let i = 0; i < overrides.length; i += 1) {
      const entry = overrides[i];
      if (!entry.match(call)) continue;
      if (entry.once) overrides.splice(i, 1);
      return entry.respond(call);
    }

    if (method === 'POST' && path === '/envelope/create') {
      counter += 1;
      const env = seedEnvelope({ id: `env-${counter}`, externalId: body?.externalId, status: 'DRAFT' });
      env.fields = [];
      return jsonResponse({ id: env.id });
    }
    if (method === 'GET' && path === '/envelope') {
      const query = parsed.searchParams.get('query');
      const data = [...envelopes.values()]
        .filter((env) => !env.deleted && env.externalId === query)
        .map(publicView);
      return jsonResponse({ data });
    }
    const getEnvelope = path.match(/^\/envelope\/([^/]+)$/);
    if (method === 'GET' && getEnvelope) {
      const env = envelopes.get(decodeURIComponent(getEnvelope[1]));
      if (!env || env.deleted) return jsonResponse({ message: 'Envelope not found' }, 404);
      return jsonResponse(publicView(env));
    }
    if (method === 'POST' && path === '/envelope/field/create-many') {
      const env = envelopes.get(body?.envelopeId);
      if (env) env.fields = [{ type: 'SIGNATURE' }, { type: 'DATE' }, { type: 'SIGNATURE' }, { type: 'DATE' }];
      return jsonResponse({ data: env?.fields || [] });
    }
    if (method === 'POST' && path === '/envelope/distribute') {
      const env = envelopes.get(body?.envelopeId);
      if (env) env.status = 'PENDING';
      return jsonResponse({ success: true });
    }
    if (method === 'POST' && path === '/envelope/delete') {
      const env = envelopes.get(body?.envelopeId);
      if (!env || env.deleted) return jsonResponse({ message: 'Envelope not found' }, 404);
      env.deleted = true;
      return jsonResponse({ success: true });
    }
    if (method === 'POST' && path === '/envelope/redistribute') return jsonResponse({ success: true });
    const download = path.match(/^\/envelope\/([^/]+)\/(audit-log|certificate)\/download$/);
    if (method === 'GET' && download) {
      const env = envelopes.get(decodeURIComponent(download[1]));
      if (!env || env.deleted) return jsonResponse({ message: 'Envelope not found' }, 404);
      return pdfResponse(PDF(`${download[2]} ${env.id}`));
    }
    const item = path.match(/^\/envelope\/item\/([^/]+)\/download$/);
    if (method === 'GET' && item) return pdfResponse(PDF(`signed ${item[1]}`));

    return jsonResponse({ message: `fake documenso: unhandled ${method} ${path}` }, 500);
  }

  return {
    fetch: fetchImpl,
    seedEnvelope,
    calls,
    envelope: (id) => envelopes.get(id) || null,
    /** Envelopes a signer could still act on. */
    liveEnvelopes: () => [...envelopes.values()].filter(
      (env) => !env.deleted && ['PENDING', 'DRAFT'].includes(env.status),
    ),
    envelopeForExternalId: (externalId) => [...envelopes.values()].find((env) => env.externalId === externalId) || null,
    signRecipient(id, signingOrder) {
      const recipient = envelopes.get(id).recipients.find((r) => r.signingOrder === signingOrder);
      recipient.signingStatus = 'SIGNED';
    },
    complete(id) {
      const env = envelopes.get(id);
      env.status = 'COMPLETED';
      env.completedAt = '2026-10-29T09:00:00.000Z';
      env.recipients.forEach((r) => { r.signingStatus = 'SIGNED'; });
    },
    /**
     * Script a response; consulted before the default behaviour. Returns a function that
     * removes the override again (for a fault that is later "fixed").
     */
    override(match, respond, { once = true } = {}) {
      const entry = { match, respond, once };
      overrides.push(entry);
      return () => {
        const index = overrides.indexOf(entry);
        if (index >= 0) overrides.splice(index, 1);
      };
    },
    callsTo(method, pathPrefix) {
      return calls.filter((call) => call.method === method && call.path.startsWith(pathPrefix));
    },
    json: jsonResponse,
    /** A PDF-bodied response, for scripting the download endpoints. */
    pdf: pdfResponse,
    /** The bytes the fake serves for an audit log, so tests can compute their hash. */
    auditLogBytes: (envelopeId) => PDF(`audit-log ${envelopeId}`),
  };
}
