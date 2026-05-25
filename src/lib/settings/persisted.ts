/**
 * Service-worker-safe reader for the persisted settings store.
 *
 * The `useSettingsStore` (src/state/settings.ts) persists via zustand's
 * `persist` middleware under the key `matrx.settings.v1`, written through
 * `chromeLocalStorage` as a JSON *string* of the shape
 * `{ "state": { ...fields }, "version": N }`.
 *
 * Non-React contexts (the SW bootstrap, the frontend-bridge handler) can't
 * mount the zustand store and hydrate it asynchronously, so they read the raw
 * blob here. Two bugs used to live in the inlined copies of this logic:
 *   1. they read the wrong key (`matrx.settings`, never written), and
 *   2. they treated the value as an already-parsed object rather than the
 *      JSON string zustand actually stores.
 * Both meant a user's `defaultPermissionMode: 'act'` was silently ignored on
 * the WebMCP and frontend-bridge tool-execution paths — they always fell back
 * to `'ask'`. This is the single source of truth so that can't drift again.
 */

import type { PermissionMode } from '@/state/settings';

/** Must match `name:` in the settings store's persist config. */
const SETTINGS_PERSIST_KEY = 'matrx.settings.v1';

interface PersistedSettingsBlob {
  state?: {
    defaultPermissionMode?: PermissionMode;
    [k: string]: unknown;
  };
  version?: number;
}

/**
 * Read the persisted settings `state` object, or null if absent / malformed.
 * Handles both the JSON-string form zustand writes and (defensively) an
 * already-parsed object.
 */
async function readPersistedSettingsState(): Promise<
  PersistedSettingsBlob['state'] | null
> {
  try {
    const r = await chrome.storage.local.get([SETTINGS_PERSIST_KEY]);
    const raw = r[SETTINGS_PERSIST_KEY];
    if (raw == null) return null;
    const blob: PersistedSettingsBlob =
      typeof raw === 'string' ? JSON.parse(raw) : (raw as PersistedSettingsBlob);
    return blob?.state ?? null;
  } catch {
    return null;
  }
}

/**
 * The user's default permission mode, read from the persisted store. Falls
 * back to `'ask'` (the safe default) when the setting is absent or unreadable.
 */
export async function readDefaultPermissionMode(): Promise<PermissionMode> {
  const state = await readPersistedSettingsState();
  return state?.defaultPermissionMode === 'act' ? 'act' : 'ask';
}
