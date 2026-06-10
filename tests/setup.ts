/**
 * Test setup. Add chrome.* mocks here as we add tests that need them.
 * Pure-logic tests (PKCE, data-pattern matcher, schemas) don't need any mocks.
 *
 * The chrome.storage.local mock below is installed once for the suite —
 * NOT reset between tests — because `lib/audit/device-key.ts` caches the
 * imported keypair in module scope. Wiping the storage mid-suite would
 * leave the cache pointing at a publicKeyId no longer recorded in
 * history, and verifyReceipt would fail with a "key not on file" error.
 * Sharing one keypair across the suite mirrors how the Service Worker
 * actually behaves in production.
 */

const _chromeStore = new Map<string, unknown>();
const _chromeLocal = {
  get: async (keys: string | string[] | Record<string, unknown> | null) => {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(_chromeStore);
    }
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    const out: Record<string, unknown> = {};
    for (const k of list) if (_chromeStore.has(k)) out[k] = _chromeStore.get(k);
    return out;
  },
  set: async (values: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(values)) _chromeStore.set(k, v);
  },
  remove: async (keys: string | string[]) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) _chromeStore.delete(k);
  },
  clear: async () => {
    _chromeStore.clear();
  },
};
const _chromeOnChanged = {
  addListener: () => {
    /* no-op */
  },
  removeListener: () => {
    /* no-op */
  },
};

(globalThis as unknown as { chrome?: unknown }).chrome = {
  storage: { local: _chromeLocal, session: _chromeLocal, onChanged: _chromeOnChanged },
};
