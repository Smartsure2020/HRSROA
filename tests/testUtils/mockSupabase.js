// In-memory Supabase mock for ROA-1 endpoint tests.
//
// Implements the minimum surface the roa-submissions endpoints and the auth
// helper actually call. Deliberately small — bugs in a large mock are worse
// than bugs in production.
//
// Never talks to the network. Storage objects are held as Node Buffers.

export function makeMockSupabase() {
  /** @type {Map<string, object>} */ const rows = new Map();
  /** @type {Map<string, Buffer>} */ const storage = new Map();
  /** @type {Map<string, {user: {id: string, email: string}} | null>} */
  const authUsers = new Map();

  function respondUserForToken(token) {
    const entry = authUsers.get(token);
    if (!entry) return { data: { user: null }, error: { message: 'invalid token' } };
    if (entry === 'throw') throw new Error('auth service unreachable');
    return { data: { user: entry.user }, error: null };
  }

  function whereMatches(row, filters) {
    for (const f of filters) {
      const [op, col, val] = f;
      const v = row[col];
      if (op === 'eq' && v !== val) return false;
      if (op === 'is' && !(val === null ? v === null || v === undefined : v === val)) return false;
      if (op === 'in' && !val.includes(v)) return false;
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
        return {
          eq(col, val) { filters.push(['eq', col, val]); return this; },
          in(col, val) { filters.push(['in', col, val]); return this; },
          is(col, val) { filters.push(['is', col, val]); return this; },
          maybeSingle: () => selectQuery(filters).maybeSingle(),
          single: () => selectQuery(filters).single(),
        };
      },
      insert(row) {
        return {
          select() {
            return {
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
          select() {
            return {
              async single() {
                const matches = Array.from(rows.values()).filter((r) => whereMatches(r, filters));
                if (matches.length !== 1) return { data: null, error: { message: `expected 1 row, got ${matches.length}` } };
                Object.assign(matches[0], patch, { updated_at: new Date().toISOString() });
                return { data: { ...matches[0] }, error: null };
              },
              async maybeSingle() {
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
    storage: {
      from(bucket) {
        if (bucket !== 'roa-pdfs') throw new Error(`Unexpected bucket ${bucket}`);
        return {
          async upload(path, bytes, _opts) {
            if (storage.has(path)) return { error: { message: `object exists at ${path}` } };
            const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
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
    },
  };
}
