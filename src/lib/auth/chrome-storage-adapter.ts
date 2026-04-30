/**
 * Async storage adapter for @supabase/supabase-js.
 *
 * supabase-js's default localStorage isn't available in MV3 service workers,
 * and `chrome.storage.local` is the right backing store.
 *
 * NOTE: We pair this with `auth.persistSession: false` and
 * `auth.autoRefreshToken: false`. Supabase's auto-refresher races with SW
 * kill/restart cycles. We drive refresh ourselves via chrome.alarms — see
 * src/lib/auth/flow.ts.
 */
export class ChromeStorageAdapter {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get([key]);
    const v = result[key];
    return typeof v === 'string' ? v : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove([key]);
  }
}
