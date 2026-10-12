import { evaluate as evaluatePanel, waitFor as poll } from './settings-panel-driver.mjs';

// Diagnostic boundary only: never dismiss, remove, or click through a portal.
export async function waitForCopyPopoverTeardown({
  panel,
  evaluate = evaluatePanel,
  waitFor = poll,
}) {
  return waitFor(
    'scrape_copy_popover_teardown',
    () =>
      evaluate(
        panel,
        `(() => {
      const tab = document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
      const pane = tab && document.getElementById(tab.getAttribute('aria-controls'));
      const ownedIds = new Set([...(pane?.querySelectorAll('button[aria-controls]') ?? [])]
        .filter(button => (button.getAttribute('title') ?? '').startsWith('Copy '))
        .map(button => button.getAttribute('aria-controls')));
      const dialogs = [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role="dialog"]')];
      return {
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        dialogsTruncated: dialogs.length > 4,
        dialogs: dialogs.slice(0, 4).map(dialog => {
          const style = getComputedStyle(dialog);
          const rect = dialog.getBoundingClientRect();
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          const hit = document.elementFromPoint?.(x, y);
          const animations = dialog.getAnimations?.({ subtree: false });
          return {
            owned: ownedIds.has(dialog.id),
            state: dialog.getAttribute('data-state'),
            display: style.display, visibility: style.visibility,
            opacity: style.opacity, pointerEvents: style.pointerEvents,
            animationName: style.animationName, animationDuration: style.animationDuration,
            animationDelay: style.animationDelay, animationPlayState: style.animationPlayState,
            animationFillMode: style.animationFillMode,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            centerInViewport: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
            centerHitInside: hit ? dialog.contains(hit) : null,
            animations: animations ? animations.slice(0, 4).map(animation => ({
              playState: animation.playState,
              currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
              endTime: animation.effect?.getComputedTiming().endTime ?? null,
            })) : null,
            animationsTruncated: animations ? animations.length > 4 : false,
          };
        }),
        activeScrapePanel: pane?.getAttribute('data-state') === 'active',
        connectedOwnedDialogs: dialogs.filter(dialog => ownedIds.has(dialog.id)).length,
        // Closed portals can outlive aria-controls; retaining any such portal is
        // independently sufficient to refuse the next pointer action.
        connectedClosedDialogs: dialogs.filter(dialog => dialog.getAttribute('data-state') === 'closed').length,
      };
    })()`,
      ),
    (state) =>
      state?.activeScrapePanel &&
      state.connectedOwnedDialogs === 0 &&
      state.connectedClosedDialogs === 0,
  );
}
