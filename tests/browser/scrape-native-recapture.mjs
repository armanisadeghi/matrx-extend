// A capture after editing local results is deferred until the user confirms
// that those edits may be discarded. Keep the native driver on that real path.
export async function confirmScrapeRecapture({ panel, evaluate, waitFor, click, resourceAction }) {
  const dialog = () =>
    evaluate(
      panel,
      `(() => {
    const dialogs = [...document.querySelectorAll('[role="alertdialog"]')]
      .filter(el => el.querySelector('[data-slot="alert-dialog-title"]')?.textContent.trim() === 'Discard unsaved edits?');
    const scrapeTab = document.querySelector('button[role="tab"][title="Scrape"][data-state="active"]');
    const pane = scrapeTab && document.getElementById(scrapeTab.getAttribute('aria-controls'));
    return {
      count: dialogs.length,
      confirm: dialogs[0]?.querySelector('button[data-slot="alert-dialog-action"]')?.textContent.trim() ?? null,
      cancel: dialogs[0]?.querySelector('button[data-slot="alert-dialog-cancel"]')?.textContent.trim() ?? null,
      edited: [...(pane?.querySelectorAll('span') ?? [])].some(el => el.textContent.trim() === 'edited'),
      deepIdle: [...(pane?.querySelectorAll('button') ?? [])].some(el =>
        (el.getAttribute('title') ?? el.getAttribute('data-matrx-title') ?? '').startsWith('Scroll the page top') &&
        !el.disabled && el.textContent.includes('Scroll & capture')),
    };
  })()`,
    );
  await waitFor(
    'scrape_discard_edits_dialog',
    dialog,
    (state) => state?.count === 1 && state.confirm === 'Re-capture' && state.cancel === 'Cancel',
  );
  await resourceAction(() => click(panel, 'scrape-recapture-dialog', 'Cancel'));
  await waitFor(
    'scrape_cancel_preserved_edits',
    dialog,
    (state) => state?.count === 0 && state.edited && state.deepIdle,
  );
  await resourceAction(() =>
    click(
      panel,
      'title',
      'Scroll the page top→bottom to load lazy content (images, infinite-scroll items), then capture. Better for dynamic pages.',
    ),
  );
  await waitFor(
    'scrape_discard_edits_dialog_reopened',
    dialog,
    (state) => state?.count === 1 && state.confirm === 'Re-capture',
  );
  await resourceAction(() => click(panel, 'scrape-recapture-dialog', 'Re-capture'));
  await waitFor('scrape_discard_edits_dialog_closed', dialog, (state) => state?.count === 0);
}
