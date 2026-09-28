import { bootstrapBackground } from '@/lib/background/bootstrap';
import { configurePanelActionClick } from '@/lib/panel/adapter';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground({
  // WXT's default standalone IIFE bundles every worker dependency, including
  // source-level lazy imports. Chrome MV3 service workers cannot use import().
  // Keep HTML entrypoints in their separate ESM build for lazy UI and CSS.
  persistent: false,
  main() {
    console.log('[matrx-extend] background SW starting', { id: chrome.runtime.id });

    // Open side panel on action click. Programmatic open requires a user
    // gesture and the action click qualifies.
    configurePanelActionClick();

    // CRITICAL: synchronous so chrome.runtime.onMessage listeners are
    // registered before any incoming message can arrive on SW wake.
    bootstrapBackground();
  },
});
