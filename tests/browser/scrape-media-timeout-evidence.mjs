import { waitFor } from './settings-panel-driver.mjs';

const resultTabs = new Set(['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema']);
const finiteDimension = (value) =>
  Number.isFinite(value) && value >= 0 ? Math.min(value, 1000000) : null;

function summarizeMediaBoundary(state, expected, label) {
  const observed = label === 'Images' ? state?.media?.imageItems : state?.media?.videoItems;
  const rows = Array.isArray(observed) ? observed : null;
  const count = state?.media?.tabCount;
  return {
    kind: label,
    selected: resultTabs.has(state?.selected) ? state.selected : null,
    visible: typeof state?.visible === 'boolean' ? state.visible : null,
    tabCount: /^\d+$/.test(count ?? '') ? Number(count) : null,
    observedCount: rows?.length ?? null,
    expectedCount: expected.length,
    items: (rows ?? []).slice(0, 16).map((item, index) => {
      const expectedIndex = expected.findIndex((fixture) =>
        label === 'Images' ? fixture.src === item.src : fixture.href === item.href,
      );
      return {
        index,
        expectedIndex: expectedIndex < 0 ? null : expectedIndex,
        ...(label === 'Images'
          ? {
              complete: typeof item.complete === 'boolean' ? item.complete : null,
              naturalWidth: finiteDimension(item.naturalWidth),
              naturalHeight: finiteDimension(item.naturalHeight),
            }
          : {}),
      };
    }),
  };
}

export async function waitForScrapeMedia(name, read, accept, expected, label, timeoutMs = 10000) {
  let lastState;
  try {
    return await waitFor(
      name,
      async () => {
        lastState = undefined;
        lastState = await read();
        return lastState;
      },
      accept,
      timeoutMs,
    );
  } catch (error) {
    if (error?.message?.startsWith(`${name}_not_observed:`)) {
      error.scrapeMediaFailure = summarizeMediaBoundary(lastState, expected, label);
    }
    throw error;
  }
}
