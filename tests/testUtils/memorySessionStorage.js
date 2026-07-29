// Minimal in-memory Storage polyfill so draft-storage tests can run under Vitest's plain
// 'node' environment without pulling in jsdom/happy-dom for the whole suite.
export function createMemorySessionStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
}
