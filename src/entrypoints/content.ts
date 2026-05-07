import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Content-script bridge — the persistent in-page agent for tools that need
 * broad DOM access (data picker, list picker, scrape capture, ref tagging).
 *
 * Roadmap item #10 (manifest hygiene): `<all_urls>` is now an optional host
 * permission. To keep WXT from auto-promoting it back into base
 * `host_permissions`, this entrypoint declares `registration: 'runtime'` —
 * the script is built and shipped with the extension but not auto-injected
 * via the manifest's `content_scripts` array.
 *
 * Injection happens two ways:
 *   - **On-demand programmatic**: `chrome.scripting.executeScript` from the
 *     SW dispatcher (e.g. `captureWithFallback` in
 *     `src/lib/scrape/capture-with-fallback.ts`). This is the path used by
 *     all tool handlers — already working today, gated by host permissions
 *     at the Chrome API level.
 *   - **Persistent on grant**: when the user toggles "All sites access" in
 *     Settings, `chrome.scripting.registerContentScripts` re-registers this
 *     script for `<all_urls>` so it auto-injects on every page like before.
 *     See `src/lib/permissions/content-scripts.ts`.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  runAt: 'document_idle',
  allFrames: false,
  async main(ctx) {
    // Lazy-load the heavy bridge so the runtime CS bootstrap stays tiny.
    const { mountContentBridge } = await import('@/lib/content/bridge');
    mountContentBridge(ctx);
  },
});
