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
