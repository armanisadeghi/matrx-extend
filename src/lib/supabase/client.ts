/**
 * Supabase client singleton.
 *
 * The extension owns OAuth token persistence and refresh through
 * chrome.storage.local + chrome.alarms (see src/lib/auth/flow.ts). Supabase JS
 * therefore receives the current access token through its custom accessToken
 * hook instead of maintaining a second, in-memory GoTrue session. This is
 * especially important for MV3: each service-worker wake creates a new JS
 * realm, while chrome.storage.local remains the canonical session state.
 */

import { ENV, STORAGE_KEYS } from '@/config/env';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
    accessToken: async () => {
      const stored = await chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN]);
      const token = stored[STORAGE_KEYS.ACCESS_TOKEN];
      return typeof token === 'string' && token.length > 0 ? token : null;
    },
    global: {
      headers: {
        'X-Client-Info': 'matrx-extend',
      },
    },
  });
  return client;
}

/**
 * Push a freshly acquired token into Realtime immediately. PostgREST, Storage,
 * and Functions read the canonical token from chrome.storage.local on every
 * request through the accessToken hook above.
 */
export async function setSupabaseSession(
  accessToken: string,
  _refreshToken: string,
): Promise<void> {
  const c = getSupabase();
  c.realtime.setAuth(accessToken);
}

export async function clearSupabaseSession(): Promise<void> {
  const c = getSupabase();
  c.realtime.setAuth();
}
