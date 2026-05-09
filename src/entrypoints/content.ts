import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Content-script bridge — the persistent in-page agent for tools that need
 * broad DOM access (data picker, list picker, scrape capture, ref tagging).
 *
 * Registered via the manifest's `content_scripts` array (the WXT default for
 * an entrypoint without `registration: 'runtime'`). Auto-injects on every
 * page that matches `<all_urls>` thanks to base `host_permissions`.
 *
 * On-demand programmatic injection via `chrome.scripting.executeScript`
 * still happens too — see `captureWithFallback` in
 * `src/lib/scrape/capture-with-fallback.ts`.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  async main(ctx) {
    // Lazy-load the heavy bridge so the CS bootstrap stays tiny.
    const { mountContentBridge } = await import('@/lib/content/bridge');
    mountContentBridge(ctx);
  },
});
