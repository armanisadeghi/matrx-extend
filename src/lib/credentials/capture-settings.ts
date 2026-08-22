/**
 * Per-site opt-out for the "Save this login?" prompt.
 *
 * Stores ORIGINS ONLY (`https://example.com`) — never a username, never a
 * value, never which login was declined. Lives in `chrome.storage.local`
 * under `STORAGE_KEYS.CAPTURE_NEVER_ORIGINS` so the service worker (which
 * decides whether to prompt) and the Settings view (which lets the user
 * forget a site) read and write the same list.
 *
 * The global on/off flag is a normal setting (`captureLoginsEnabled` in
 * `src/state/settings.ts`, read SW-side through
 * `src/lib/settings/persisted.ts#readCaptureLoginsEnabled`).
 */

import { STORAGE_KEYS } from '@/config/env';

const KEY = STORAGE_KEYS.CAPTURE_NEVER_ORIGINS;
/** A runaway page cannot grow the list without bound. */
const MAX_ORIGINS = 500;

function asOriginList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((o): o is string => typeof o === 'string' && o.length > 0);
}

export async function readNeverCaptureOrigins(): Promise<string[]> {
  try {
    const r = await chrome.storage.local.get([KEY]);
    return asOriginList(r[KEY]);
  } catch {
    return [];
  }
}

export async function isNeverCaptureOrigin(origin: string): Promise<boolean> {
  return (await readNeverCaptureOrigins()).includes(origin);
}

export async function addNeverCaptureOrigin(origin: string): Promise<void> {
  const list = await readNeverCaptureOrigins();
  if (list.includes(origin)) return;
  await chrome.storage.local.set({ [KEY]: [...list, origin].slice(-MAX_ORIGINS) });
}

export async function removeNeverCaptureOrigin(origin: string): Promise<void> {
  const list = await readNeverCaptureOrigins();
  if (!list.includes(origin)) return;
  await chrome.storage.local.set({ [KEY]: list.filter((o) => o !== origin) });
}
