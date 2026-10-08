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

const recaptureDialogExpression = `(() => [...document.querySelectorAll('[role="alertdialog"]')]
  .some(dialog => dialog.getBoundingClientRect().height > 0 &&
    dialog.querySelector('[data-slot="alert-dialog-title"]')?.textContent?.trim() ===
    'Discard unsaved edits?' &&
    dialog.querySelector('button[data-slot="alert-dialog-action"]')?.textContent?.trim() ===
    'Re-capture'))()`;

// Observe the owned edited capture while its Article pane is still visible, before navigation hides it.
export const ownedEditedBadgeExpression = `(() => {
  const tab = document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
  const pane = tab && document.getElementById(tab.getAttribute('aria-controls'));
  const article = [...(pane?.querySelectorAll('[role="tablist"] [role="tab"]') ?? [])]
    .find(node => node.getAttribute('aria-selected') === 'true' &&
      node.firstChild?.textContent?.trim() === 'Article');
  const content = article && document.getElementById(article.getAttribute('aria-controls'));
  return !!content && content.getAttribute('data-state') === 'active' &&
    [...content.querySelectorAll('span')].some(node =>
      node.textContent?.trim() === 'edited' && node.getBoundingClientRect().height > 0);
})()`;

export function createPostReloadCaptureBoundary(ownedEditedBadgeVisible) {
  return {
    pointer_phase: null,
    click_events: null,
    busy_observed: null,
    owned_edited_badge_visible: ownedEditedBadgeVisible === true,
    branch: null,
    discard_dialog_visible: null,
    trusted_confirmation_returned: false,
    ready: false,
    article_selected: false,
    visible: false,
    fixture_title_matches: false,
    fixture_text_present: false,
  };
}

const capturedReferrals = (state) =>
  state?.selected === 'Article' &&
  state.visible &&
  state.title === 'Harbor Dental referral hours' &&
  state.resultText?.includes('Referral coordinators answer weekday calls.');

const ownedRecaptureDialog = (state) =>
  state?.ready === true &&
  state.empty === true &&
  state.title === 'Harbor Dental referral hours' &&
  state.recaptureDialog === true;

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
    const outcome = await waitFor(
      'scrape_post_reload_referrals_captured',
      async () => ({
        ...(await scrapeState(panel)),
        recaptureDialog: await evaluate(panel, recaptureDialogExpression),
      }),
      (state) => capturedReferrals(state) || ownedRecaptureDialog(state),
      30000,
      captureTimeoutDiagnostic,
    );
    if (ownedRecaptureDialog(outcome) && !capturedReferrals(outcome)) {
      boundary.branch = 'discard_confirmation';
      boundary.discard_dialog_visible = true;
      await resourceAction(() => click(panel, 'scrape-recapture-dialog', 'Re-capture'));
      boundary.trusted_confirmation_returned = true;
      const confirmed = await waitFor(
        'scrape_post_reload_referrals_captured',
        () => scrapeState(panel),
        capturedReferrals,
        30000,
        captureTimeoutDiagnostic,
      );
      Object.assign(boundary, captureTimeoutDiagnostic(confirmed));
    } else {
      boundary.branch = 'already_captured';
      boundary.discard_dialog_visible = false;
      Object.assign(boundary, captureTimeoutDiagnostic(outcome));
    }
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
