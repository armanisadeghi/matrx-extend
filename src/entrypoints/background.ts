import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground({
  type: 'module',
  persistent: false,
  main() {
    console.log('[matrx-extend] background SW starting', { id: chrome.runtime.id });

    // Open side panel on action click. Programmatic open requires a user gesture
    // and the action click qualifies. This is the normal pattern.
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => console.error('[matrx-extend] sidePanel.setPanelBehavior failed', err));

    // Lazy-init core systems on first event (avoids slowing every SW wake).
    void import('@/lib/background/bootstrap').then(({ bootstrapBackground }) =>
      bootstrapBackground(),
    );
  },
});
