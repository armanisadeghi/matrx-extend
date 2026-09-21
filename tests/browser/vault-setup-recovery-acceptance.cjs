'use strict';

const crypto = require('node:crypto');

/*
 * Real-CDP setup/recovery acceptance for the existing Vault side panel.
 *
 * This helper owns only disposable localhost pages. It never reads or writes
 * Vault data, never clicks Fill, and returns only boolean evidence. The caller
 * supplies an already authenticated, real extension panel and an existing
 * saved-login target. It is intentionally not wired into the runner yet: the
 * runner must admit it only in a no-write phase.
 */

const CLOSED_ROOT_PATH = '/vault-setup-recovery-closed-root';
const NO_FOCUSED_LOGIN_REMEDY =
  'No login field is ready to fill. Enter the login manually, or focus the username or password field on a supported sign-in page and try Fill again.';
const RESTRICTED_PAGE_REMEDY =
  "This browser page can't be filled. Open a sign-in page on a regular website, or enter the login manually.";

function renderVaultSetupRecoveryFixtureHTML() {
  return `<!doctype html><html><body>
    <main><h1>Disposable inaccessible login fixture</h1><x-closed-login></x-closed-login></main>
    <script>
      (() => {
        const host = document.querySelector('x-closed-login');
        const root = host.attachShadow({ mode: 'closed' });
        const form = document.createElement('form');
        form.method = 'post'; form.action = '/submitted';
        const username = document.createElement('input');
        username.type = 'email'; username.autocomplete = 'username'; username.name = 'email';
        const password = document.createElement('input');
        password.type = 'password'; password.autocomplete = 'current-password'; password.name = 'password';
        const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Sign in';
        form.append(username, password, submit); root.append(form);
        form.addEventListener('submit', (event) => { event.preventDefault(); fetch('/submitted', { method: 'POST' }); });
        // The fixture can inspect its own values without exposing the closed
        // root to page code or to the extension's discovery path.
        window.__vaultSetupRecoveryFixture = Object.freeze({
          focusPassword: () => password.focus(),
          state: () => ({ usernameEmpty: username.value === '', passwordEmpty: password.value === '', focusedPassword: root.activeElement === password }),
        });
      })();
    </script>
  </body></html>`;
}

async function tabFor(worker, url, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tabId = await worker.evaluate(async (expectedUrl) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === expectedUrl)?.id,
    url);
    if (Number.isInteger(tabId)) return tabId;
    await wait(100);
  }
  throw new Error('vault_setup_recovery_fixture_tab_missing');
}

async function uniqueTabFor(worker, url, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ids = await worker.evaluate(async (expectedUrl) =>
      (await chrome.tabs.query({})).filter((tab) => tab.url === expectedUrl)
        .map((tab) => tab.id).filter(Number.isInteger),
    url);
    if (Array.isArray(ids) && ids.length === 1) return ids[0];
    await wait(100);
  }
  throw new Error('vault_setup_recovery_restricted_tab_not_unique');
}

async function waitForBridge(worker, tabId, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const mounted = await worker.evaluate(async (id) => {
      const result = await chrome.scripting.executeScript({
        target: { tabId: id, frameIds: [0] },
        func: () => window.__matrx_bridge_mounted === true,
      });
      return result[0]?.result === true;
    }, tabId);
    if (mounted) return;
    await wait(100);
  }
  throw new Error('vault_setup_recovery_fixture_bridge_not_ready');
}

const fillFor = (targetName) => `(() => {
  const cards = Array.from(document.querySelectorAll('li')).filter((card) =>
    card.querySelector('span')?.textContent?.trim() === ${JSON.stringify(targetName)});
  if (cards.length !== 1) return null;
  const controls = Array.from(cards[0].querySelectorAll('button')).filter((button) =>
    button.textContent?.trim() === 'Fill');
  return controls.length === 1 ? controls[0] : null;
})()`;

const noFocusedLoginManualRecoveryVisible = `(() => {
  const paragraphs = Array.from(document.querySelectorAll('p'));
  const manualRecovery = paragraphs.some((node) => node.textContent?.trim() === ${JSON.stringify(NO_FOCUSED_LOGIN_REMEDY)});
  const fillOrSignIn = Array.from(document.querySelectorAll('button')).some((button) =>
    button.textContent?.trim() === 'Fill' || button.textContent?.trim() === 'Sign in');
  return manualRecovery && !fillOrSignIn;
})()`;

const restrictedManualRecoveryVisible = `(() => {
  const paragraphs = Array.from(document.querySelectorAll('p'));
  const manualRecovery = paragraphs.some((node) => node.textContent?.trim() === ${JSON.stringify(RESTRICTED_PAGE_REMEDY)});
  const fillOrSignIn = Array.from(document.querySelectorAll('button')).some((button) =>
    button.textContent?.trim() === 'Fill' || button.textContent?.trim() === 'Sign in');
  return manualRecovery && !fillOrSignIn;
})()`;

/**
 * Proves that inaccessible and browser-restricted pages do not imply a fill,
 * describe a manual recovery that is actually possible, and recover when the
 * caller restores an ordinary, extension-reachable localhost login form.
 */
exports.runVaultSetupRecoveryChecks = async ({
  context, worker, realPanel, targetName, parentLoginUrl, getSubmitCount,
  getVaultWriteCount, snapshotOwnedReceiptState, assert, wait, checkpoint = () => {}, proof,
  focusOwnedBrowser, verifyRealVaultPanel,
}) => {
  assert(context && worker && realPanel, 'vault_setup_recovery_context_missing');
  assert(typeof targetName === 'string' && targetName.length > 0, 'vault_setup_recovery_target_missing');
  assert(typeof parentLoginUrl === 'string' && typeof getSubmitCount === 'function'
    && typeof getVaultWriteCount === 'function' && typeof snapshotOwnedReceiptState === 'function',
  'vault_setup_recovery_fixture_missing');
  assert(typeof assert === 'function' && typeof wait === 'function' && typeof focusOwnedBrowser === 'function'
    && typeof verifyRealVaultPanel === 'function', 'vault_setup_recovery_controls_missing');
  const parent = new URL(parentLoginUrl);
  assert(parent.protocol === 'http:' && parent.hostname === '127.0.0.1', 'vault_setup_recovery_parent_origin_invalid');
  const closedRootUrl = new URL(CLOSED_ROOT_PATH, parent.origin).href;
  const baselineSubmits = getSubmitCount();
  assert(Number.isInteger(baselineSubmits) && baselineSubmits >= 0, 'vault_setup_recovery_submit_counter_invalid');
  const evidence = proof.setupRecovery = {
    closedRootManualRecovery: false,
    restrictedPageManualRecovery: false,
    inaccessiblePagesNoWritesOrSubmit: false,
    normalPagePanelReadinessRecovered: false,
    wholeHelperNoWritesOrSubmit: false,
    fixturePagesClosed: false,
  };
  const ownedPages = new Set();
  const vaultWritesBefore = getVaultWriteCount();
  const receiptBefore = JSON.stringify(snapshotOwnedReceiptState());
  assert(Number.isInteger(vaultWritesBefore) && vaultWritesBefore >= 0, 'vault_setup_recovery_write_counter_invalid');
  assert(typeof receiptBefore === 'string', 'vault_setup_recovery_receipt_snapshot_invalid');
  let page;
  let primaryFailure;
  const focusOwnedTab = async (url, focus) => {
    const tabId = await tabFor(worker, url, wait);
    await focusOwnedBrowser(tabId);
    await focus();
    return tabId;
  };
  try {
    checkpoint('vault_setup_recovery_closed_root');
    page = await context.newPage(); ownedPages.add(page);
    await page.goto(closedRootUrl, { waitUntil: 'domcontentloaded' });
    const closedTabId = await tabFor(worker, closedRootUrl, wait);
    await waitForBridge(worker, closedTabId, wait);
    await page.bringToFront();
    await focusOwnedBrowser(closedTabId);
    await page.evaluate(() => window.__vaultSetupRecoveryFixture?.focusPassword());
    const closedState = await page.evaluate(() => window.__vaultSetupRecoveryFixture?.state());
    assert(closedState?.focusedPassword === true && closedState.usernameEmpty === true && closedState.passwordEmpty === true,
      'vault_setup_recovery_closed_root_fixture_invalid');
    await verifyRealVaultPanel();
    await realPanel.waitFor(noFocusedLoginManualRecoveryVisible, true, 15000);
    assert((await page.locator('#matrx-inline-login-suggestion').count()) === 0, 'vault_setup_recovery_closed_root_overlay_present');
    evidence.closedRootManualRecovery = true;

    checkpoint('vault_setup_recovery_restricted_page');
    const restrictedUrl = `about:blank#vault-setup-${crypto.randomUUID()}`;
    await page.goto(restrictedUrl, { waitUntil: 'domcontentloaded' });
    const restrictedTabId = await uniqueTabFor(worker, restrictedUrl, wait);
    await focusOwnedBrowser(restrictedTabId);
    await verifyRealVaultPanel();
    await realPanel.waitFor(restrictedManualRecoveryVisible, true, 15000);
    evidence.restrictedPageManualRecovery = true;

    assert(getSubmitCount() === baselineSubmits, 'vault_setup_recovery_inaccessible_page_submitted');
    assert(getVaultWriteCount() === vaultWritesBefore, 'vault_setup_recovery_inaccessible_page_vault_write');
    assert(JSON.stringify(snapshotOwnedReceiptState()) === receiptBefore, 'vault_setup_recovery_inaccessible_page_receipt_changed');
    evidence.inaccessiblePagesNoWritesOrSubmit = true;

    checkpoint('vault_setup_recovery_accessible_page');
    const recoveryUrl = new URL(parentLoginUrl);
    recoveryUrl.searchParams.set('setup-recovery', crypto.randomUUID());
    await page.goto(recoveryUrl.href, { waitUntil: 'domcontentloaded' });
    const parentTabId = await uniqueTabFor(worker, recoveryUrl.href, wait);
    await waitForBridge(worker, parentTabId, wait);
    await page.bringToFront();
    await focusOwnedTab(recoveryUrl.href, () => page.locator('#password').focus());
    await page.waitForFunction(() => document.hasFocus() && document.activeElement?.id === 'password');
    await verifyRealVaultPanel();
    const fill = fillFor(targetName);
    await realPanel.waitFor(`!!(${fill}) && !(${fill}).disabled`, true, 15000);
    assert((await page.locator('#matrx-inline-login-suggestion').count()) === 0, 'vault_setup_recovery_accessible_overlay_present');
    assert(getSubmitCount() === baselineSubmits, 'vault_setup_recovery_accessible_page_submitted');
    evidence.normalPagePanelReadinessRecovered = true;
    assert(getVaultWriteCount() === vaultWritesBefore, 'vault_setup_recovery_whole_helper_vault_write');
    assert(JSON.stringify(snapshotOwnedReceiptState()) === receiptBefore, 'vault_setup_recovery_whole_helper_receipt_changed');
    evidence.wholeHelperNoWritesOrSubmit = true;
  } catch (error) {
    primaryFailure = error;
  } finally {
    for (const owned of ownedPages) await owned.close().catch(() => {});
    evidence.fixturePagesClosed = [...ownedPages].every((owned) => owned.isClosed());
  }
  if (primaryFailure) throw primaryFailure;
  assert(Object.values(evidence).every((value) => value === true), 'vault_setup_recovery_evidence_incomplete');
  return evidence;
};

exports.renderVaultSetupRecoveryFixtureHTML = renderVaultSetupRecoveryFixtureHTML;
exports.vaultSetupRecoveryFixturePath = CLOSED_ROOT_PATH;
