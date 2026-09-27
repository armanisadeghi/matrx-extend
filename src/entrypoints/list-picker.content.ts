import { mountListPicker } from '@/lib/data-pattern/list-picker';
import type { ListPickerWindow } from '@/lib/data-pattern/list-picker-session';
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
  main() {
    // Install synchronously; the caller starts it with its own session identity.
    (window as ListPickerWindow).__matrxListPickerStart = mountListPicker;
  },
});
