import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Highlighter content script. Registered but only injected on demand from the
 * Highlight side-panel tab via chrome.scripting.executeScript so it never runs
 * on every page.
 *
 * The overlay UI lives in src/lib/highlights/highlighter.ts inside a Shadow
 * DOM root. Mounting is idempotent (guarded by window.__matrxHighlighter), so
 * re-injection while already active is a safe no-op — the side panel just
 * follows up with HIGHLIGHT_PAINT / HIGHLIGHT_STOP / HIGHLIGHT_SET_MODE
 * messages, which the mounted overlay listens for.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main() {
    const { mountHighlighter } = await import('@/lib/highlights/highlighter');
    mountHighlighter();
  },
});
