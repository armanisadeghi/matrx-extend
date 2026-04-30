/**
 * Supabase client singleton.
 *
 * Configured to NEVER refresh tokens itself — we drive that ourselves through
 * chrome.alarms (see src/lib/auth/flow.ts). persistSession is also off; the
 * extension owns token persistence in chrome.storage.local with explicit
 * encryption for the refresh token.
 *
 * After signIn, call setSupabaseSession() with the access + refresh tokens so
 * RLS policies see auth.uid() correctly.
 */

import { ENV } from '@/config/env';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
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
 * Push the current OAuth tokens into the Supabase JS client so it includes
 * the user's JWT on RLS-gated reads/writes and Realtime subscriptions.
 */
export async function setSupabaseSession(accessToken: string, refreshToken: string): Promise<void> {
  const c = getSupabase();
  const { error } = await c.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    console.warn('[matrx-extend] supabase.setSession failed', error.message);
  }
}

export async function clearSupabaseSession(): Promise<void> {
  const c = getSupabase();
  await c.auth.signOut({ scope: 'local' }).catch(() => undefined);
}
