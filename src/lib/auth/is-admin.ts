/**
 * Shared, fail-closed admin check for execution-time gates.
 *
 * Reads the cached `matrx.user.isAdmin` flag that `use-auth` persists after
 * verifying the signed-in user against `public.admins`. This is the SW's own
 * record — deliberately NOT anything a request payload self-reports
 * (`client.state["browser-dom"].is_admin` is advisory for server-side
 * discovery; it must never gate execution).
 *
 * Fail-closed: any storage error, missing key, or non-`true` value reads as
 * "not admin". Used by the tool dispatcher's `admin_only` execution gate —
 * see docs/AUDIT_2026_06_10.md P0-2.
 */

import { STORAGE_KEYS } from '@/config/env';

export async function readIsAdminFromStorage(): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get([STORAGE_KEYS.IS_ADMIN]);
    return r[STORAGE_KEYS.IS_ADMIN] === true;
  } catch {
    return false;
  }
}
