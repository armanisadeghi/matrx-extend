import { defineContentScript } from 'wxt/utils/define-content-script';

/**
 * Diagnose-picker content script. Registered but only mounted on demand from
 * the Scrape tab via chrome.scripting.executeScript with an `args:[mode]`
 * payload so it doesn't run on every page.
 *
 * The actual picker UI lives in src/lib/scrape/diagnose-picker.ts and is
 * rendered inside a Shadow DOM root so site CSS can't bleed in.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  runAt: 'document_idle',
  async main() {
    // Read the mode from a data attribute set on documentElement by the
    // launcher (see use-scrape.ts). Falls back to 'missing' if not set.
    const raw = document.documentElement.getAttribute('data-matrx-diagnose-mode');
    const mode: 'missing' | 'unwanted' = raw === 'unwanted' ? 'unwanted' : 'missing';
    document.documentElement.removeAttribute('data-matrx-diagnose-mode');
    const { mountDiagnosePicker } = await import('@/lib/scrape/diagnose-picker');
    mountDiagnosePicker(mode);
  },
});
