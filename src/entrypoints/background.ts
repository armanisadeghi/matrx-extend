import { bootstrapBackground } from '@/lib/background/bootstrap';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground({
  type: 'module',
  persistent: false,
  main() {
    console.log('[matrx-extend] background SW starting', { id: chrome.runtime.id });

    // Open side panel on action click. Programmatic open requires a user
    // gesture and the action click qualifies.
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error('[matrx-extend] sidePanel.setPanelBehavior failed', err));

    // CRITICAL: synchronous so chrome.runtime.onMessage listeners are
    // registered before any incoming message can arrive on SW wake.
    bootstrapBackground();
  },
});
