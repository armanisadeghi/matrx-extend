import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Data-picker content script. Registered but only mounted on demand from the
 * Data tab via chrome.scripting.executeScript so it doesn't run on every page.
 *
 * The actual picker UI lives in src/lib/data-pattern/picker.ts and is rendered
 * inside a Shadow DOM root so site CSS can't bleed in.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main() {
    const { mountPicker } = await import('@/lib/data-pattern/picker');
    mountPicker();
  },
});
