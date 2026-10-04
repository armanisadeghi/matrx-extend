import { evaluate, waitFor } from './settings-panel-driver.mjs';

export async function waitForReplacementScrapeTab(panel, timeoutMs) {
  let first;
  let attempts = 0;
  const last = await waitFor(
    'replacement_scrape_tab_ready',
    async () => {
      const sample = await evaluate(
        panel,
        `(() => {
    const tabs = [...document.querySelectorAll('button[role="tab"][title="Scrape"]')];
    const visible = tabs.filter((tab) => {
      const style = getComputedStyle(tab), rect = tab.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !tab.closest('[inert]');
    });
    return { matched: tabs.length, visible: visible.length };
  })()`,
      );
      first ??= sample;
      attempts += 1;
      return sample;
    },
    (sample) => sample?.matched === 1 && sample.visible === 1,
    timeoutMs,
  );
  return { first, last, attempts };
}
