/**
 * Per-extension-session instance ID.
 *
 * Minted once per browser session and persisted in `chrome.storage.session`
 * so it survives Service Worker idle/wake cycles within the same Chrome
 * session. Resets when the user closes Chrome — by design, since a fresh
 * Chrome process is logically a new "instance" of the extension.
 *
 * The `instanceId` is carried in the v2 cross-component envelope's
 * `fromInstance` field so other components can target replies back to
 * this specific extension instance (e.g., the desktop engine completing
 * a task started by this extension).
 */

const STORAGE_KEY = 'matrx.crossComponent.instanceId';

let cachedId: string | null = null;

/**
 * Return the per-session instance ID, minting one on first call.
 * Subsequent calls within the same SW lifetime return the cached value
 * without touching storage.
 */
export async function getOrMintInstanceId(): Promise<string> {
  if (cachedId) return cachedId;

  try {
    const got = await chrome.storage.session.get([STORAGE_KEY]);
    const existing = got[STORAGE_KEY] as string | undefined;
    if (typeof existing === 'string' && existing.length > 0) {
      cachedId = existing;
      return existing;
    }
  } catch {
    // chrome.storage.session unavailable (e.g. unit test, older Chrome).
    // Fall through to fresh-mint; cachedId still binds for this session.
  }

  const fresh = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `ext-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: fresh });
  } catch {
    // Same fallback path — keep the in-memory cachedId binding even if
    // storage write fails.
  }
  cachedId = fresh;
  return fresh;
}

/**
 * Convenience: return a {component, instanceId} ref ready to drop into
 * a v2 envelope's `fromInstance` field.
 */
export async function getInstanceRef(): Promise<{ component: 'extension'; instanceId: string }> {
  return { component: 'extension', instanceId: await getOrMintInstanceId() };
}
