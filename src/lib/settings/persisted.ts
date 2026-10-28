/**
 * Service-worker-safe reader for the persisted settings store.
 *
 * The `useSettingsStore` (src/state/settings.ts) persists via zustand's
 * `persist` middleware under the key `matrx.settings.v1`, written through
 * `chromeLocalStorage` as a JSON *string* of the shape
 * `{ "state": { ...fields }, "version": N }`.
 *
 * Non-React contexts read local preferences here. Permission mode comes from
 * the shared platform setting through readActModeInWorker.
 */

import type { CredentialAssistancePresentation } from '@/state/settings';
import { type ActMode, readActModeInWorker } from './act-without-asking';

/** Must match `name:` in the settings store's persist config. */
const SETTINGS_PERSIST_KEY = 'matrx.settings.v1';

interface PersistedSettingsBlob {
  state?: {
    captureLoginsEnabled?: boolean;
    offerSavedLoginsEnabled?: boolean;
    credentialAssistancePresentation?: CredentialAssistancePresentation;
    [k: string]: unknown;
  };
  version?: number;
}

/**
 * Read the persisted settings `state` object, or null if absent / malformed.
 * Handles both the JSON-string form zustand writes and (defensively) an
 * already-parsed object.
 */
async function readPersistedSettingsState(): Promise<PersistedSettingsBlob['state'] | null> {
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
 * The user's permission mode from the shared platform setting.
 */
export async function readDefaultPermissionMode(): Promise<ActMode> {
  // ONE setting (`chat.act_without_asking`, platform default Act — Arman 2026-10-22).
  return readActModeInWorker();
}

/**
 * Whether the "Save this login?" prompt is on. Absent (fresh install, or a
 * store written before the flag existed) means ON — it is the default.
 */
export async function readCaptureLoginsEnabled(): Promise<boolean> {
  const state = await readPersistedSettingsState();
  return state?.captureLoginsEnabled !== false;
}

/** Whether focused login fields may offer a metadata-only Vault chooser. */
export async function readOfferSavedLoginsEnabled(): Promise<boolean> {
  const state = await readPersistedSettingsState();
  return state?.offerSavedLoginsEnabled !== false;
}

/** Quiet is the safe migration/default for absent, corrupt, and unknown values. */
export async function readCredentialAssistancePresentation(): Promise<CredentialAssistancePresentation> {
  const state = await readPersistedSettingsState();
  return state?.credentialAssistancePresentation === 'on_page' ? 'on_page' : 'quiet';
}

/**
 * A synchronous view of the person's default permission mode for the service worker's
 * dispatcher. The dispatcher falls back to it when a run opens without a latched mode; a
 * hard-coded 'ask' there ignored "Act without asking" for exactly those runs. Kept current
 * from the platform snapshot.
 */
export function watchDefaultPermissionMode(): () => ActMode {
  // The platform default is Act; the person's setting refreshes on every read (the snapshot is
  // cached briefly, so this is one fetch per cache window, never per call).
  let current: ActMode = 'act';
  const refresh = () =>
    void readDefaultPermissionMode().then((m) => {
      current = m;
    });
  refresh();
  return () => {
    refresh();
    return current;
  };
}
