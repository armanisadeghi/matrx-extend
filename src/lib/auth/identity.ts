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
 * extension ID and callback. The resulting authorization error had no
 * on-device signal pointing at the identity mismatch. This log fixes that.
 *
 * See `.research/v0.1.4-auth-incident.md` for the full incident write-up.
 */

import { ENV } from '@/config/env';
import { EXPECTED_EXTENSION_IDS, getExpectedExtensionIdentity } from '@/config/identity';
import { log } from '@/lib/debug/log';

export interface ExtensionIdentity {
  runtime_id: string;
  redirect_uri: string;
  oauth_client_id: string;
  supabase_url: string;
  expected_ids: readonly string[];
  known_id: boolean;
  expected_redirect_uri: string;
  redirect_matches_expected: boolean;
  matches_expected: boolean;
  extension_version: string;
  extension_name: string;
  user_agent?: string;
}

export function readExtensionIdentity(): ExtensionIdentity {
  const runtime_id = chrome.runtime.id;
  const redirect_uri = chrome.identity?.getRedirectURL ? chrome.identity.getRedirectURL() : '';
  const expectedIdentity = getExpectedExtensionIdentity(runtime_id);
  const known_id = expectedIdentity !== undefined;
  const expected_redirect_uri = expectedIdentity?.redirect_uri ?? '';
  const redirect_matches_expected = known_id && redirect_uri === expected_redirect_uri;
  return {
    runtime_id,
    redirect_uri,
    oauth_client_id: ENV.EXTENSION_OAUTH_CLIENT_ID ?? '(unset)',
    supabase_url: ENV.SUPABASE_URL ?? '(unset)',
    expected_ids: EXPECTED_EXTENSION_IDS,
    known_id,
    expected_redirect_uri,
    redirect_matches_expected,
    matches_expected: known_id && redirect_matches_expected,
    extension_version: chrome.runtime.getManifest().version,
    extension_name: chrome.runtime.getManifest().name,
    ...(typeof navigator !== 'undefined' && { user_agent: navigator.userAgent }),
  };
}

let logged = false;

/**
 * Log the identity bundle once per context boot. `warn` level when the
 * runtime ID or actual callback differs from its configured identity. `info`
 * level means both runtime facts matched exactly.
 */
export function logExtensionIdentityOnce(): void {
  if (logged) return;
  logged = true;
  const id = readExtensionIdentity();
  if (!id.matches_expected) {
    log.warn(
      'auth',
      `extension identity DRIFT — runtime id "${id.runtime_id}" and redirect URI "${id.redirect_uri}" do not exactly match a configured extension identity. Confirm this exact runtime redirect URI on the OAuth client.`,
      id,
    );
  } else {
    log.info('auth', `extension identity ok (${id.runtime_id})`, id);
  }
}
