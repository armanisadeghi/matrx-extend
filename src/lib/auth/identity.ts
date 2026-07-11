/**
 * Extension-identity diagnostics — emitted on every SW + sidepanel boot.
 *
 * The full bundle of "who am I" facts the auth flow depends on, logged in
 * one structured event so any future ID drift / redirect mismatch is
 * visible to the user (or to us if we ask for the debug-log dump) without
 * a debug build.
 *
 * Why we care: v0.1.4 shipped to the Web Store with our manifest's `key`
 * field — but the Store replaced it with its own keypair, producing a new
 * extension ID that wasn't on Supabase's redirect-URI allowlist. Sign-in
 * failed instantly with "Authorization page could not be loaded" and we
 * had no on-device signal pointing at the cause. This log fixes that.
 *
 * See `.research/v0.1.4-auth-incident.md` for the full incident write-up.
 */

import { ENV } from '@/config/env';
import { EXPECTED_EXTENSION_IDS, isExpectedExtensionId } from '@/config/identity';
import { log } from '@/lib/debug/log';

export interface ExtensionIdentity {
  runtime_id: string;
  redirect_uri: string;
  oauth_client_id: string;
  supabase_url: string;
  expected_ids: readonly string[];
  matches_expected: boolean;
  extension_version: string;
  extension_name: string;
  user_agent?: string;
}

export function readExtensionIdentity(): ExtensionIdentity {
  const runtime_id = chrome.runtime.id;
  const redirect_uri = chrome.identity?.getRedirectURL ? chrome.identity.getRedirectURL() : '';
  return {
    runtime_id,
    redirect_uri,
    oauth_client_id: ENV.EXTENSION_OAUTH_CLIENT_ID ?? '(unset)',
    supabase_url: ENV.SUPABASE_URL ?? '(unset)',
    expected_ids: EXPECTED_EXTENSION_IDS,
    matches_expected: isExpectedExtensionId(runtime_id),
    extension_version: chrome.runtime.getManifest().version,
    extension_name: chrome.runtime.getManifest().name,
    ...(typeof navigator !== 'undefined' && { user_agent: navigator.userAgent }),
  };
}

let logged = false;

/**
 * Log the identity bundle once per context boot. `warn` level when the
 * runtime ID isn't in `EXPECTED_EXTENSION_IDS` so an unrecognized build
 * surfaces in the errors-only filter — same behavior as a real production
 * regression. `info` level when everything matches.
 */
export function logExtensionIdentityOnce(): void {
  if (logged) return;
  logged = true;
  const id = readExtensionIdentity();
  if (!id.matches_expected) {
    log.warn(
      'auth',
      `extension identity DRIFT — runtime id "${id.runtime_id}" is not in EXPECTED_EXTENSION_IDS. Sign-in will fail unless https://${id.runtime_id}.chromiumapp.org/ is registered in Supabase.`,
      id,
    );
  } else {
    log.info('auth', `extension identity ok (${id.runtime_id})`, id);
  }
}
