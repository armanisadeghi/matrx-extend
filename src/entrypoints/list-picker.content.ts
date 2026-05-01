import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Two-phase list-pattern picker. Mirrors data-picker.content.ts: registered
 * but mounted on demand from the Showcase's List Pattern tab via
 * chrome.scripting.executeScript.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main() {
    const { mountListPicker } = await import('@/lib/data-pattern/list-picker');
    mountListPicker();
  },
});
