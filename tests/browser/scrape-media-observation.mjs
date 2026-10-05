import { assertMediaPane } from './scrape-media-assertions.mjs';
import { waitForScrapeMedia } from './scrape-media-timeout-evidence.mjs';

export async function observeSelectedMedia({
  panel,
  label,
  items,
  name,
  evaluate,
  scrapeState,
  timeoutMs = 10000,
}) {
  if (label === 'Images') {
    await evaluate(
      panel,
      `(() => {
      const outer=document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
      const pane=outer&&document.getElementById(outer.getAttribute('aria-controls'));
      const tab=pane?.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
      const content=tab&&document.getElementById(tab.getAttribute('aria-controls'));
      for(const image of content?.querySelectorAll('img')??[]) image.scrollIntoView({block:'center',behavior:'instant'});
    })()`,
    );
  }
  const state = await waitForScrapeMedia(
    name,
    () => scrapeState(panel),
    (s) => {
      const actual = label === 'Images' ? s?.media?.imageItems : s?.media?.videoItems;
      return (
        s?.selected === label &&
        s.visible &&
        actual?.length === items.length &&
        (label !== 'Images' || actual.every((item) => item.complete && item.naturalWidth > 0))
      );
    },
    items,
    label,
    timeoutMs,
  );
  return assertMediaPane(state, { label, items });
}

export function retainScrapeMediaFailure(report, error) {
  if (error?.scrapeMediaFailure) report.scrape_media_failure = error.scrapeMediaFailure;
}
