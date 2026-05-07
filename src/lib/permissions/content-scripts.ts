/**
 * Dynamic content-script registration tied to the optional `<all_urls>`
 * host grant.
 *
 * Roadmap item #10 moved `<all_urls>` from base `host_permissions` to
 * `optional_host_permissions`. The persistent content-script entrypoint
 * (`src/entrypoints/content.ts`) is also flagged `registration: 'runtime'`
 * so WXT does NOT auto-add it to the manifest's `content_scripts` array —
 * otherwise WXT would promote `<all_urls>` back into base host_permissions
 * and the install dialog would still ask for everything.
 *
 * This module bridges the gap: when the user grants `<all_urls>` (from
 * Settings → Advanced agent capabilities), we register the content script
 * dynamically so it auto-injects on every page like it used to. When the
 * grant is revoked, we unregister it.
 *
 * Idempotent — safe to call on every SW boot. Listens to
 * `chrome.permissions.onAdded` / `onRemoved` so the registration tracks
 * the live grant state without UI hand-holding.
 *
 * Tools that don't need persistent injection (most of them — they go
 * through the SW dispatcher and use `chrome.scripting.executeScript`)
 * don't depend on this. They get on-demand injection through
 * `captureWithFallback` and friends.
 */

import { log } from '@/lib/debug/log';
import { hasOptionalHostPermissions } from '@/lib/permissions/optional';

/**
 * Stable id used for the dynamically-registered persistent content script.
 * Picking a unique id (not 'content') avoids conflicting with anything
 * WXT might register itself.
 */
const CONTENT_SCRIPT_ID = 'matrx-content-bridge';

/**
 * Path to the bundled content-script entry. WXT outputs the script for any
 * `defineContentScript` entrypoint regardless of `registration: 'runtime'`,
 * so this path is stable across builds.
 */
const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

async function isRegistered(): Promise<boolean> {
  if (!chrome.scripting?.getRegisteredContentScripts) return false;
  try {
    const list = await chrome.scripting.getRegisteredContentScripts({
      ids: [CONTENT_SCRIPT_ID],
    });
    return list.length > 0;
  } catch {
    return false;
  }
}

async function register(): Promise<void> {
  if (!chrome.scripting?.registerContentScripts) return;
  if (await isRegistered()) return;
  try {
    await chrome.scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_ID,
        matches: ['<all_urls>'],
        js: [CONTENT_SCRIPT_FILE],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    log.info('sw', `registered content script for <all_urls>`);
  } catch (err) {
    // Most likely cause: missing host permission. Don't spam errors —
    // we'll retry on the next onAdded event.
    log.warn('sw', 'registerContentScripts failed', (err as Error).message);
  }
}

async function unregister(): Promise<void> {
  if (!chrome.scripting?.unregisterContentScripts) return;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    log.info('sw', `unregistered content script for <all_urls>`);
  } catch (err) {
    // Already unregistered — fine. Don't surface as warn (this is the
    // expected path on first boot before any grant has happened).
    void err;
  }
}

async function reconcile(): Promise<void> {
  const granted = await hasOptionalHostPermissions(['<all_urls>']);
  if (granted) {
    await register();
  } else {
    await unregister();
  }
}

let started = false;

/**
 * Boot: reconcile registration with the current permission state, then
 * subscribe to permission grant / revoke events so we keep tracking.
 *
 * Call once from the SW bootstrap. Idempotent.
 */
export function startContentScriptRegistrar(): void {
  if (started) return;
  started = true;
  log.info('sw', 'content-script registrar started');

  void reconcile();

  if (chrome.permissions?.onAdded) {
    chrome.permissions.onAdded.addListener((perms) => {
      if (perms.origins?.includes('<all_urls>')) {
        void register();
      }
    });
  }
  if (chrome.permissions?.onRemoved) {
    chrome.permissions.onRemoved.addListener((perms) => {
      if (perms.origins?.includes('<all_urls>')) {
        void unregister();
      }
    });
  }
}
