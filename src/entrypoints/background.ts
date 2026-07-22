import { bootstrapBackground } from '@/lib/background/bootstrap';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground({
  type: 'module',
  persistent: false,
  main() {
    console.log('[matrx-extend] background SW starting', { id: chrome.runtime.id });

    // Vite's __vitePreload helper and a few browser visibility/session
    // shims dereference `document` / `window` in code paths that fire
    // here even though the SW has no DOM. The libs catch the throw
    // internally — Chrome still prints it as "Uncaught (in promise)".
    // Swallow only that specific class so real errors still surface.
    self.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason as unknown;
      if (
        reason instanceof ReferenceError &&
        /\b(document|window)\b is not defined/.test(reason.message)
      ) {
        event.preventDefault();
      }
    });

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
