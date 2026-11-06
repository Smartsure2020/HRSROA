// In-memory Supabase mock for ROA-1 endpoint tests.
//
// Implements the minimum surface the roa-submissions endpoints and the auth
// helper actually call. Deliberately small — bugs in a large mock are worse
// than bugs in production.
//
// Never talks to the network. Storage objects are held as Node Buffers.

import { isDeepStrictEqual } from 'node:util';

export function makeMockSupabase() {
  /** @type {Map<string, object>} */ const rows = new Map();
  /** @type {Map<string, Buffer>} */ const storage = new Map();
  /** @type {Map<string, {user: {id: string, email: string}} | null>} */
  const authUsers = new Map();
  let nextInsertError = null;
  let nextRpcError = null;
  let dropNextRpcResponse = false;
  const rpcCalls = [];
  /** @type {Array<{ match: Function, run: Function, once: boolean }>} */
  const updateHooks = [];
  let uploadMode = null; // null | 'fail' | 'corrupt' — applies to the next storage upload only

  // Deterministic interleaving for concurrency tests: a hook runs at the instant an UPDATE is
  // about to be applied, i.e. after the caller made its decision from an earlier read and
  // before its write lands. It may mutate rows (another request got there first) and/or return
  // `{ error }` to fail the write (the process died or the database refused). The write then
  // evaluates its filters against whatever the hook left behind, exactly like the real thing.
  function runUpdateHooks(patch) {
    for (let i = 0; i < updateHooks.length; i += 1) {
      const hook = updateHooks[i];
      if (!hook.match(patch)) continue;
      if (hook.once) updateHooks.splice(i, 1);
      const outcome = hook.run(patch);
      if (outcome?.error) return outcome;
      return null;
    }
    return null;
  }

  const rpcFailure = (code, message) => ({ data: null, error: { code, message } });

  // Mirrors public.roa_create_revision (supabase/migrations/20261029_roa_amendments.sql): one
  // atomic step that locks nothing in JS only because a JS test is single-threaded — the
  // check-then-write below has no await in it, so two "concurrent" calls serialise exactly
  // like the real function's FOR UPDATE. The SQL is verified against a real Postgres in
  // tests/amendmentSql.test.js; this keeps the endpoint tests honest about its contract.
  function emulateCreateRevision(a) {
    const prev = rows.get(a.p_supersedes_id);
    if (!prev || String(prev.advisor_email).toLowerCase() !== String(a.p_owner_email).toLowerCase()) {
      return rpcFailure('RA001', 'roa_revision_predecessor_not_found');
    }
    const existing = rows.get(a.p_new_id);
    if (existing) {
      const same = existing.supersedes_submission_id === a.p_supersedes_id
        && String(existing.advisor_email).toLowerCase() === String(a.p_owner_email).toLowerCase()
        && existing.roa_type === a.p_roa_type
        && existing.pdf_sha256 === a.p_pdf_sha256
        && existing.pdf_storage_path === a.p_pdf_storage_path
        && existing.pdf_byte_length === a.p_pdf_byte_length
        && isDeepStrictEqual(existing.snapshot_json, a.p_snapshot)
        && (existing.amendment_reason ?? null) === (a.p_amendment_reason ?? null)
        && (existing.amendment_reason_detail ?? null) === (a.p_amendment_reason_detail ?? null);
      if (!same) return rpcFailure('RA007', 'roa_revision_id_conflict');
      if (!prev.superseded_by_submission_id) prev.superseded_by_submission_id = a.p_new_id; // heal a missing link
      return { data: { ...existing }, error: null };
    }
    if (prev.superseded_by_submission_id) return rpcFailure('RA006', 'roa_revision_already_superseded');
    if (prev.roa_type !== a.p_roa_type) return rpcFailure('RA003', 'roa_revision_type_mismatch');

    const now = new Date().toISOString();
    const created = {
      id: a.p_new_id,
      roa_type: a.p_roa_type,
      status: 'submitted',
      advisor_user_id: a.p_advisor_user_id,
      advisor_email: String(a.p_owner_email).toLowerCase(),
      client_reference: a.p_client_reference,
      snapshot_json: a.p_snapshot,
      template_version: a.p_template_version,
      statutory_disclosure_version: a.p_statutory_disclosure_version,
      broker_appointment_version: a.p_broker_appointment_version,
      broker_fee_version: a.p_broker_fee_version,
      letter_investigation_version: a.p_letter_investigation_version,
      pdf_sha256: a.p_pdf_sha256,
      pdf_storage_path: a.p_pdf_storage_path,
      pdf_byte_length: a.p_pdf_byte_length,
      revision_no: (prev.revision_no || 1) + 1,
      parent_submission_id: prev.parent_submission_id || prev.id,
      supersedes_submission_id: prev.id,
      superseded_by_submission_id: null,
      amendment_reason: a.p_amendment_reason,
      amendment_reason_detail: a.p_amendment_reason_detail,
      amended_by: String(a.p_amended_by).toLowerCase(),
      amended_at: now,
      submitted_at: now,
      created_at: now,
      updated_at: now,
    };
    rows.set(created.id, created);
    prev.superseded_by_submission_id = created.id;
    return { data: { ...created }, error: null };
  }

  function respondUserForToken(token) {
    const entry = authUsers.get(token);
    if (!entry) return { data: { user: null }, error: { message: 'invalid token' } };
    if (entry === 'throw') throw new Error('auth service unreachable');
    // Supabase Auth only issues sessions for confirmed emails (autoconfirm off);
    // fixtures can override this to model an unconfirmed / anonymous / banned user.
    return {
      data: { user: { email_confirmed_at: '2026-01-01T00:00:00.000Z', ...entry.user } },
      error: null,
    };
  }

  // Postgres LIKE/ILIKE semantics: `%` any run, `_` any single char, backslash
  // escapes the next character. Case-insensitive for ILIKE.
  function likeToRegExp(pattern) {
    let source = '';
    for (let i = 0; i < pattern.length; i += 1) {
      const ch = pattern[i];
      if (ch === '\\' && i + 1 < pattern.length) {
        i += 1;
        source += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      } else if (ch === '%') {
        source += '.*';
      } else if (ch === '_') {
        source += '.';
      } else {
        source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    return new RegExp(`^${source}$`, 'i');
  }

  function whereMatches(row, filters) {
    for (const f of filters) {
      const [op, col, val] = f;
      const v = row[col];
      if (op === 'eq' && v !== val) return false;
      if (op === 'is' && !(val === null ? v === null || v === undefined : v === val)) return false;
      if (op === 'in' && !val.includes(v)) return false;
      if (op === 'ilike' && !(typeof v === 'string' && likeToRegExp(val).test(v))) return false;
    }
    return true;
  }

  function selectQuery(filters) {
    const matches = Array.from(rows.values()).filter((r) => whereMatches(r, filters));
    return {
      async single() {
        if (matches.length === 0) return { data: null, error: { message: 'no rows' } };
        if (matches.length > 1) return { data: null, error: { message: 'multiple rows' } };
        return { data: matches[0], error: null };
      },
      async maybeSingle() {
        if (matches.length === 0) return { data: null, error: null };
        return { data: matches[0], error: null };
      },
    };
  }

  function tableQuery() {
    const filters = [];
    const chain = {
      select(_columns) {
        const selectBuilder = {
          eq(col, val) { filters.push(['eq', col, val]); return this; },
          in(col, val) { filters.push(['in', col, val]); return this; },
          is(col, val) { filters.push(['is', col, val]); return this; },
          ilike(col, val) { filters.push(['ilike', col, val]); return this; },
          maybeSingle: () => selectQuery(filters).maybeSingle(),
          single: () => selectQuery(filters).single(),
          then(onFulfilled, onRejected) {
            const data = Array.from(rows.values())
              .filter((r) => whereMatches(r, filters))
              .map((r) => ({ ...r }));
            return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
          },
        };
        return selectBuilder;
      },
      insert(row) {
        return {
          select() {
            return {
              async single() {
                if (nextInsertError) {
                  const message = nextInsertError;
                  nextInsertError = null;
                  return { data: null, error: { message } };
                }
                if (rows.has(row.id)) {
                  return { data: null, error: { message: `duplicate id ${row.id}` } };
                }
                const stored = { ...row };
                rows.set(row.id, stored);
                return { data: { ...stored }, error: null };
              },
            };
          },
          // Fallback if caller doesn't chain .select() (not used in this app).
          async single() {
            if (rows.has(row.id)) {
              return { data: null, error: { message: `duplicate id ${row.id}` } };
            }
            const stored = { ...row };
            rows.set(row.id, stored);
            return { data: { ...stored }, error: null };
          },
        };
      },
      update(patch) {
        const updateBuilder = {
          eq(col, val) { filters.push(['eq', col, val]); return this; },
          in(col, val) { filters.push(['in', col, val]); return this; },
          is(col, val) { filters.push(['is', col, val]); return this; },
          ilike(col, val) { filters.push(['ilike', col, val]); return this; },
          select() {
            return {
              async single() {
                const intercepted = runUpdateHooks(patch);
                if (intercepted) return { data: null, error: intercepted.error };
                const matches = Array.from(rows.values()).filter((r) => whereMatches(r, filters));
                if (matches.length !== 1) return { data: null, error: { message: `expected 1 row, got ${matches.length}` } };
                Object.assign(matches[0], patch, { updated_at: new Date().toISOString() });
                return { data: { ...matches[0] }, error: null };
              },
              async maybeSingle() {
                const intercepted = runUpdateHooks(patch);
                if (intercepted) return { data: null, error: intercepted.error };
                const matches = Array.from(rows.values()).filter((r) => whereMatches(r, filters));
                if (matches.length === 0) return { data: null, error: null };
                Object.assign(matches[0], patch, { updated_at: new Date().toISOString() });
                return { data: { ...matches[0] }, error: null };
              },
            };
          },
          // Terminal chain without `.select()` — treated as an "await update" no-op.
          then(onFulfilled, onRejected) {
            try {
              const matches = Array.from(rows.values()).filter((r) => whereMatches(r, filters));
              for (const r of matches) {
                Object.assign(r, patch, { updated_at: new Date().toISOString() });
              }
              return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
            } catch (err) {
              return Promise.reject(err).then(onFulfilled, onRejected);
            }
          },
        };
        return updateBuilder;
      },
    };
    return chain;
  }

  const client = {
    auth: {
      async getUser(token) {
        return respondUserForToken(token);
      },
    },
    from(table) {
      if (table !== 'roa_submissions') throw new Error(`Unexpected table ${table}`);
      return tableQuery();
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (nextRpcError) {
        const message = nextRpcError;
        nextRpcError = null;
        return rpcFailure('XX000', message);
      }
      if (name !== 'roa_create_revision') return rpcFailure('42883', `unknown function ${name}`);
      const outcome = emulateCreateRevision(args);
      if (outcome.error) return outcome;
      if (dropNextRpcResponse) {
        // The transaction committed but the caller never hears about it.
        dropNextRpcResponse = false;
        return rpcFailure('08006', 'connection lost');
      }
      return outcome;
    },
    storage: {
      from(bucket) {
        if (bucket !== 'roa-pdfs') throw new Error(`Unexpected bucket ${bucket}`);
        return {
          async upload(path, bytes, _opts) {
            if (storage.has(path)) return { error: { message: `object exists at ${path}` } };
            const mode = uploadMode;
            uploadMode = null;
            if (mode === 'fail') return { error: { message: 'injected storage failure' } };
            let buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
            // 'corrupt': the object is stored, but is not the bytes that were sent.
            if (mode === 'corrupt') buf = Buffer.concat([buf, Buffer.from('corrupted')]);
            storage.set(path, buf);
            return { error: null };
          },
          async download(path) {
            const buf = storage.get(path);
            if (!buf) return { data: null, error: { message: `object missing at ${path}` } };
            return {
              data: {
                async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
              },
              error: null,
            };
          },
        };
      },
    },
  };

  return {
    client,
    /** Fixture accessors — never used by production code. */
    fixtures: {
      addAuthUser(token, user) { authUsers.set(token, { user }); },
      addFailingAuthToken(token) { authUsers.set(token, 'throw'); },
      allRows: () => Array.from(rows.values()).map((r) => ({ ...r })),
      getRow: (id) => rows.get(id) ? { ...rows.get(id) } : null,
      getStorage: (path) => storage.get(path) ? Buffer.from(storage.get(path)) : null,
      countObjects: () => storage.size,
      countRows: () => rows.size,
      // Direct mutation for edge-case testing (e.g. simulate corruption).
      putStorage: (path, bytes) => storage.set(path, Buffer.from(bytes)),
      deleteStorage: (path) => storage.delete(path),
      putRow: (id, patch) => Object.assign(rows.get(id) || {}, patch),
      // Seeds a complete row exactly as given (e.g. a pre-cutover row stamped with a
      // legacy ROA Auth id and a mixed-case advisor_email).
      insertRow: (row) => { rows.set(row.id, { ...row }); },
      failNextInsert: (message = 'injected insert failure') => { nextInsertError = message; },
      // The next revision RPC fails before doing anything (a definite failure).
      failNextRpc: (message = 'injected rpc failure') => { nextRpcError = message; },
      // The next revision RPC COMMITS but its response is lost (an ambiguous failure).
      loseNextRpcResponse: () => { dropNextRpcResponse = true; },
      rpcCalls: () => rpcCalls.map((call) => ({ ...call })),
      // Runs `run(patch)` just before the next UPDATE whose patch satisfies `match(patch)` is
      // applied (see runUpdateHooks). Return `{ error: { message } }` to fail that write.
      onUpdate: (match, run, { once = true } = {}) => { updateHooks.push({ match, run, once }); },
      pendingUpdateHooks: () => updateHooks.length,
      // The next storage upload fails outright / is silently stored with the wrong bytes.
      failNextUpload: () => { uploadMode = 'fail'; },
      corruptNextUpload: () => { uploadMode = 'corrupt'; },
      reset() {
        updateHooks.length = 0;
        uploadMode = null;
        rows.clear();
        storage.clear();
        authUsers.clear();
        nextInsertError = null;
        nextRpcError = null;
        dropNextRpcResponse = false;
        rpcCalls.length = 0;
      },
    },
  };
}
