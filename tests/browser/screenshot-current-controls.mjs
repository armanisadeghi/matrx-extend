// Native orchestration only: the browser supplies all dialog/image/link state.
import assert from 'node:assert/strict';
import { click, evaluate, waitFor } from './settings-panel-driver.mjs';

export async function screenshotViewer(panel, next = 'close') {
  const before = await evaluate(
    panel,
    'chrome.tabs.query({currentWindow:true}).then(tabs=>tabs.map(tab=>tab.id))',
  );
  await click(panel, 'screenshot-open', 'thumbnail');
  await waitFor(
    'owned_viewer_image',
    () =>
      evaluate(
        panel,
        `(() => {
    const dialogs=[...document.querySelectorAll('[role="dialog"]')];
    const image=dialogs.length===1?dialogs[0].querySelector('img'):null;
    const card=document.querySelector('button[title="View screenshot"] img');
    return !!image && image.complete && image.naturalWidth>0 && image.src===card?.src;
  })()`,
      ),
    (value) => value === true,
    10000,
  );
  const after = await evaluate(
    panel,
    'chrome.tabs.query({currentWindow:true}).then(tabs=>tabs.map(tab=>tab.id))',
  );
  assert.deepEqual(after, before, 'thumbnail viewer must not open or close browser tabs');
  await click(panel, 'screenshot-dialog', next === 'share' ? 'Share' : 'Close');
  await waitFor(
    'viewer_closed',
    () => evaluate(panel, `!document.querySelector('[role="dialog"] img')`),
    (value) => value === true,
    10000,
  );
  return { sameLoadedPreview: true, browserTabsUnchanged: true, viewerClosed: true };
}

export async function screenshotPublicLink(panel, observeClipboard, evidence = {}) {
  await screenshotViewer(panel, 'share');
  await waitFor(
    'share_manager_empty',
    () =>
      evaluate(
        panel,
        `(() => {
    const dialog=document.querySelector('[role="dialog"]');
    return dialog?.innerText.includes('Share screenshot') && dialog.innerText.includes('No share links');
  })()`,
      ),
    (value) => value === true,
    10000,
  );
  let created = false;
  let revoked = false;
  try {
    await click(panel, 'screenshot-dialog', 'Create public link');
    created = true;
    evidence.publicLinkMayNeedCleanup = true;
    const url = await waitFor(
      'new_public_link',
      () =>
        evaluate(
          panel,
          `(() => {
      const dialog=document.querySelector('[role="dialog"]');
      const link=dialog?.querySelector('input[aria-label="New public link"]')?.value;
      const existing=[...(dialog?.querySelectorAll('input[aria-label="Public share link"]')??[])];
      return existing.length===1 && existing[0].value===link ? link : null;
    })()`,
        ),
      (value) =>
        typeof value === 'string' && /^https:\/\/(?:www\.)?aimatrx\.com\/(?:s|r)\//.test(value),
      10000,
    );
    await click(panel, 'screenshot-dialog', 'Copy new public link');
    await observeClipboard(url);
    await click(panel, 'screenshot-dialog', 'Revoke');
    await waitFor(
      'public_link_revoked',
      () =>
        evaluate(
          panel,
          `(() => {
      const dialog=document.querySelector('[role="dialog"]');
      const buttons=[...(dialog?.querySelectorAll('button')??[])].filter(button=>button.textContent.trim()==='Revoke');
      return buttons.length===1 && buttons[0].disabled && dialog.innerText.includes('Revoked') && !dialog.querySelector('input[aria-label="New public link"]');
    })()`,
        ),
      (value) => value === true,
      10000,
    );
    revoked = true;
    evidence.ownedLinkRevoked = true;
    evidence.publicLinkMayNeedCleanup = false;
    return { publicLinkCreated: true, actualClipboardMatched: true, ownedLinkRevoked: true };
  } finally {
    // Fresh capture + empty-list precondition makes the one active link ours.
    if (created && !revoked) {
      await cleanupOwnedPublicLink(panel, evidence);
    }
    await click(panel, 'screenshot-dialog', 'Close');
  }
}

async function cleanupOwnedPublicLink(panel, evidence) {
  const active = await evaluate(
    panel,
    `[...document.querySelectorAll('[role="dialog"] button')].filter(button=>button.textContent.trim()==='Revoke'&&!button.disabled).length`,
  );
  if (active === 1) {
    await click(panel, 'screenshot-dialog', 'Revoke');
    await waitFor(
      'owned_link_cleanup_revoked',
      () =>
        evaluate(
          panel,
          `(() => {
          const dialog=document.querySelector('[role="dialog"]');
          const revoke=[...(dialog?.querySelectorAll('button')??[])].filter(button=>button.textContent.trim()==='Revoke');
          return revoke.length===1 && revoke[0].disabled && dialog.innerText.includes('Revoked');
        })()`,
        ),
      (value) => value === true,
      10000,
    );
    evidence.ownedLinkRevoked = true;
    evidence.publicLinkMayNeedCleanup = false;
  } else {
    // Zero controls alone cannot prove a pending create did not land.
    const refused = await evaluate(
      panel,
      `!!document.querySelector('[role="dialog"] [role="alert"]') && !document.querySelector('[role="dialog"] input[aria-label="New public link"]')`,
    );
    if (active !== 0 || !refused) throw new Error('owned_public_link_cleanup_unverified');
    evidence.publicLinkMayNeedCleanup = false;
  }
}
