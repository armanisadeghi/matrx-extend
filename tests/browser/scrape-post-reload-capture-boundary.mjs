import { armBusyExpression, readBusyExpression } from './scrape-busy-observer.mjs';

const TITLE = 'Capture the page exactly as it is right now';

export const armClickExpression = `(() => {
  globalThis.__scrapePostReloadClickProbe?.dispose();
  let clicks = 0;
  const onClick = (event) => {
    const button = event.target?.closest?.('button');
    if ((button?.getAttribute('title') ?? button?.getAttribute('data-matrx-title')) ===
        ${JSON.stringify(TITLE)}) clicks++;
  };
  document.addEventListener('click', onClick, { capture: true });
  globalThis.__scrapePostReloadClickProbe = {
    read: () => clicks,
    dispose: () => document.removeEventListener('click', onClick, { capture: true }),
  };
})()`;

export const disposeClickExpression = `(() => {
  const probe = globalThis.__scrapePostReloadClickProbe;
  if (!probe) return null;
  delete globalThis.__scrapePostReloadClickProbe;
  try { return probe.read(); } finally { probe.dispose(); }
})()`;

const disposeBusyExpression = `(() => {
  globalThis.__scrapeBusyObserver?.disconnect();
  delete globalThis.__scrapeBusyObserver;
})()`;

// Only these fixed fields can reach the native failure receipt.
export function captureTimeoutDiagnostic(state) {
  return {
    ready: state?.ready === true,
    article_selected: state?.selected === 'Article',
    visible: state?.visible === true,
    fixture_title_matches: state?.title === 'Harbor Dental referral hours',
    fixture_text_present:
      state?.resultText?.includes('Referral coordinators answer weekday calls.') === true,
  };
}

export async function runPostReloadCaptureBoundary({
  panel,
  evaluate,
  click,
  resourceAction,
  waitFor,
  scrapeState,
  boundary,
}) {
  let clickArmAttempted = false;
  let busyArmAttempted = false;
  let busyArmed = false;
  try {
    clickArmAttempted = true;
    await evaluate(panel, armClickExpression);
    busyArmAttempted = true;
    await evaluate(panel, armBusyExpression(TITLE));
    busyArmed = true;
    await resourceAction(() =>
      click(panel, 'title', TITLE, (phase) => {
        boundary.pointer_phase = phase;
      }),
    );
    await waitFor(
      'scrape_post_reload_referrals_captured',
      () => scrapeState(panel),
      (state) =>
        state?.selected === 'Article' &&
        state.visible &&
        state.title === 'Harbor Dental referral hours' &&
        state.resultText?.includes('Referral coordinators answer weekday calls.'),
      30000,
      captureTimeoutDiagnostic,
    );
  } finally {
    if (clickArmAttempted) {
      try {
        boundary.click_events = await evaluate(panel, disposeClickExpression);
      } catch {
        // A vanished panel leaves the measurement unknown.
      }
    }
    if (busyArmed) {
      try {
        boundary.busy_observed = (await evaluate(panel, readBusyExpression)).observed;
      } catch {
        // A vanished panel leaves the measurement unknown.
      }
    } else if (busyArmAttempted) {
      try {
        await evaluate(panel, disposeBusyExpression);
      } catch {
        // A vanished panel has already discarded its observer.
      }
    }
  }
}
