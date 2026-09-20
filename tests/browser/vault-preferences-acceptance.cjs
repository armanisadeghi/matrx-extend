'use strict';

const crypto = require('node:crypto');
const { runVaultAccessibilityChecks } = require('./vault-accessibility-acceptance.cjs');
const SAVED_MATCHING = 'Offer saved logins on sign-in forms';
const ON_PAGE = 'Show password suggestions on websites';
const STABLE_ABSENCE_MS = 6_200;

const switchFor = (label) => '(() => { const labels = Array.from(document.querySelectorAll("span")).filter((node) => node.textContent?.trim() === ' + JSON.stringify(label) + '); if (labels.length !== 1) return null; const row = labels[0].parentElement?.parentElement; const controls = row ? Array.from(row.querySelectorAll("[role=switch]")) : []; return controls.length === 1 ? controls[0] : null; })()';
const fillFor = (targetName) => '(() => { const cards = Array.from(document.querySelectorAll("li")).filter((card) => card.querySelector("span")?.textContent?.trim() === ' + JSON.stringify(targetName) + '); if (cards.length !== 1) return null; const buttons = Array.from(cards[0].querySelectorAll("button")).filter((button) => button.textContent?.trim() === "Fill"); return buttons.length === 1 ? buttons[0] : null; })()';
const privacyControl = () => '(() => { const buttons = Array.from(document.querySelectorAll("button[aria-expanded][aria-controls]")).filter((node) => node.textContent?.trim() === "Privacy"); return buttons.length === 1 ? buttons[0] : null; })()';
const receiptSnapshotValid = (value) => value && typeof value === 'object'
  && value.vaultItemPosts && typeof value.vaultItemPosts === 'object'
  && Object.keys(value.vaultItemPosts).sort().join(',') === 'invalidIdempotencyHeader,missingIdempotencyHeader,total,withIdempotencyHeader'
  && ['total', 'withIdempotencyHeader', 'missingIdempotencyHeader', 'invalidIdempotencyHeader'].every((key) => Object.hasOwn(value.vaultItemPosts, key) && Number.isInteger(value.vaultItemPosts[key]) && value.vaultItemPosts[key] >= 0)
  && Array.isArray(value.ownedCreateMutationKeys) && value.ownedCreateMutationKeys.every((key) => typeof key === 'string')
  && Array.isArray(value.ownedFixtureIds) && value.ownedFixtureIds.every((id) => typeof id === 'string');
const canonicalReceipt = (value) => JSON.stringify({
  vaultItemPosts: Object.fromEntries(Object.entries(value.vaultItemPosts).sort(([a], [b]) => a.localeCompare(b))),
  ownedCreateMutationKeys: [...value.ownedCreateMutationKeys].sort(),
  ownedFixtureIds: [...value.ownedFixtureIds].sort(),
});

async function tabFor(worker, url, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const id = await worker.evaluate(async (expected) => (await chrome.tabs.query({})).find((tab) => tab.url === expected)?.id, url);
    if (Number.isInteger(id)) return id;
    await wait(100);
  }
  throw new Error('preferences_fixture_tab_missing');
}
async function waitForBridge(worker, tabId, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const mounted = await worker.evaluate(async (id) => {
      const result = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, func: () => window.__matrx_bridge_mounted === true });
      return result[0]?.result === true;
    }, tabId);
    if (mounted) return;
    await wait(100);
  }
  throw new Error('preferences_fixture_bridge_not_ready');
}

exports.runVaultPreferencesChecks = async ({
  context, worker, realPanel, targetName, username, password, parentLoginUrl,
  getSubmitCount, assert, wait, checkpoint = () => {}, proof, focusOwnedBrowser,
  verifyRealVaultPanel, snapshotOwnedReceiptState,
}) => {
  assert(context && worker && realPanel && typeof verifyRealVaultPanel === 'function', 'preferences_context_missing');
  assert(typeof targetName === 'string' && typeof username === 'string' && typeof password === 'string' && typeof parentLoginUrl === 'string', 'preferences_input_missing');
  assert(typeof getSubmitCount === 'function' && typeof assert === 'function' && typeof wait === 'function' && typeof focusOwnedBrowser === 'function' && typeof snapshotOwnedReceiptState === 'function', 'preferences_controls_missing');
  const parent = new URL(parentLoginUrl);
  assert(parent.protocol === 'http:' && parent.hostname === '127.0.0.1', 'preferences_parent_origin_invalid');
  const baseline = getSubmitCount();
  assert(Number.isInteger(baseline) && baseline >= 0, 'preferences_submit_counter_invalid');
  const evidence = {
    matchingDisabledNoActionableFill: false, matchingDisabledNoOverlay: false,
    matchingEnabledQuietFill: false, onPageFocusedCredentialOnly: false,
    onPageDisabledQuiet: false, privacyAccessibleNames: false, keyboardSwitchReachableAndOperable: false,
    noWebsiteSubmission: false, receiptStateUnchanged: false, settingsRestored: false, pageClosed: false,
  };
  let page; let tabId; let primaryFailure; let originalMatching; let originalOnPage; let receiptBefore;
  const settingsActive = () => realPanel.evaluate('document.querySelector("[title=Settings]")?.getAttribute("aria-selected") === "true"');
  const openSettings = async () => {
    if (!(await settingsActive())) {
      await realPanel.click('document.querySelector("[title=Settings]")');
      await realPanel.waitFor('document.querySelector("[title=Settings]")?.getAttribute("aria-selected") === "true"', true, 10000);
    }
  };
  const ensurePrivacyOpen = async () => {
    await openSettings();
    const open = await realPanel.evaluate('(() => { const control = (' + privacyControl() + '); const content = control ? document.getElementById(control.getAttribute("aria-controls")) : null; return control?.getAttribute("aria-expanded") === "true" && content?.getAttribute("aria-hidden") === "false"; })()');
    if (!open) {
      await realPanel.click(privacyControl());
      await realPanel.waitFor('(() => { const control = (' + privacyControl() + '); const content = control ? document.getElementById(control.getAttribute("aria-controls")) : null; return control?.getAttribute("aria-expanded") === "true" && content?.getAttribute("aria-hidden") === "false"; })()', true, 10000);
    }
  };
  const stateOf = async (label) => {
    const result = await realPanel.evaluate('(() => { const control = (' + switchFor(label) + '); return control?.getAttribute("aria-checked") ?? null; })()');
    if (result !== 'true' && result !== 'false') throw new Error('preferences_switch_state_unavailable');
    return result === 'true';
  };
  const ensure = async (label, expected) => {
    await ensurePrivacyOpen();
    if ((await stateOf(label)) !== expected) {
      await realPanel.click(switchFor(label));
      await realPanel.waitFor('(() => { const control = (' + switchFor(label) + '); return control?.getAttribute("aria-checked") === ' + JSON.stringify(String(expected)) + '; })()', true, 10000);
    }
  };
  const accessibility = async () => {
    await ensurePrivacyOpen();
    const result = await realPanel.evaluate('(() => { const labels = ' + JSON.stringify([SAVED_MATCHING, ON_PAGE]) + '; return labels.every((label) => { const nodes = Array.from(document.querySelectorAll("span")).filter((node) => node.textContent?.trim() === label); const row = nodes.length === 1 ? nodes[0].parentElement?.parentElement : null; const controls = row ? Array.from(row.querySelectorAll("[role=switch]")) : []; return controls.length === 1 && controls[0].getAttribute("aria-label") === label; }); })()');
    assert(result === true, 'preferences_privacy_accessible_name_missing');
    evidence.privacyAccessibleNames = true;
  };
  const keyboardSwitch = async () => {
    assert(typeof realPanel.key === 'function', 'preferences_native_keyboard_unavailable');
    await ensurePrivacyOpen();
    const original = await stateOf(SAVED_MATCHING);
    await realPanel.evaluate('(' + privacyControl() + ')?.focus()');
    await realPanel.waitFor('document.activeElement === (' + privacyControl() + ')');
    let reached = false;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      await realPanel.key({ key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      reached = await realPanel.evaluate('document.activeElement === (' + switchFor(SAVED_MATCHING) + ') && document.activeElement.matches(":focus-visible")');
      if (reached) break;
    }
    assert(reached === true, 'preferences_switch_not_keyboard_reachable');
    for (const expected of [!original, original]) {
      await realPanel.key({ key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
      await realPanel.waitFor('(' + switchFor(SAVED_MATCHING) + ')?.getAttribute("aria-checked") === ' + JSON.stringify(String(expected)));
      assert(await realPanel.evaluate('document.activeElement === (' + switchFor(SAVED_MATCHING) + ')'), 'preferences_switch_lost_keyboard_focus');
    }
    evidence.keyboardSwitchReachableAndOperable = true;
  };
  const noOverlay = async () => (await page.locator('#matrx-inline-login-suggestion').count()) === 0;
  const focus = async (selector) => {
    await page.bringToFront();
    await focusOwnedBrowser(tabId);
    const browserFocus = await worker.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id);
      const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      return tab.active === true && tab.windowId === focused.id && focused.type === 'normal' && focused.focused === true;
    }, tabId);
    assert(browserFocus === true, 'preferences_fixture_not_active_focused_normal_window');
    await page.locator(selector).focus();
    const documentFocus = await page.evaluate((expected) => document.hasFocus() && document.activeElement?.id === expected.slice(1), selector);
    assert(documentFocus === true, 'preferences_fixture_document_or_element_not_focused');
    await wait(300);
  };
  const focusCredential = async () => focus('#password');
  const focusUnrelated = async () => focus('#sign-in');
  const stableAbsence = async (check, code) => {
    const deadline = Date.now() + STABLE_ABSENCE_MS;
    while (true) {
      assert(await check(), code);
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await wait(Math.min(200, remaining));
    }
  };
  const recordQuietFillFailure = async (disposition) => {
    let diagnostic = {
      disposition,
      collected: false,
      ui: null,
      panelStatus: null,
    };
    try {
      diagnostic = await realPanel.evaluate(`(async () => {
        const targetCards = Array.from(document.querySelectorAll('li')).filter((card) =>
          card.querySelector('span')?.textContent?.trim() === ${JSON.stringify(targetName)}
        );
        const fillControls = targetCards.length === 1
          ? Array.from(targetCards[0].querySelectorAll('button')).filter((button) => button.textContent?.trim() === 'Fill')
          : [];
        const paragraphs = Array.from(document.querySelectorAll('p')).map((node) => node.textContent?.trim());
        const ui = {
          targetCardCount: targetCards.length,
          fillControlCount: fillControls.length,
          fillControlDisabled: fillControls.length === 1 ? fillControls[0].disabled === true : null,
          unavailable: paragraphs.includes('Saved logins are unavailable right now. Focus the login field to try again.'),
          loading: paragraphs.includes('Checking saved logins…'),
          noOffer: paragraphs.includes('Click the username or password box on the website, then choose Fill.'),
          disabledRemedy: paragraphs.includes('Turn on saved-login matching in extension settings to use Fill.'),
          filledFeedback: paragraphs.includes('Filled. Review the form, then sign in.'),
        };
        let panelStatus;
        try {
          const value = await chrome.runtime.sendMessage({
            __matrx: true,
            kind: 'credential-suggestions:panel-status',
            payload: { tabId: ${JSON.stringify(tabId)} },
          });
          const record = !!value && typeof value === 'object' && !Array.isArray(value);
          const keys = record ? Object.keys(value) : [];
          const status = record && ['ready', 'none', 'disabled', 'loading', 'unavailable'].includes(value.status)
            ? value.status : 'other';
          let safePageUrl = false;
          let normalizedPageUrl = false;
          let pageUrlHasCredentials = null;
          if (record && typeof value.pageUrl === 'string') {
            try {
              const url = new URL(value.pageUrl);
              safePageUrl = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname));
              normalizedPageUrl = value.pageUrl === url.origin + url.pathname;
              pageUrlHasCredentials = !!url.username || !!url.password;
            } catch {}
          }
          panelStatus = {
            requestSucceeded: true,
            record,
            keyCount: keys.length,
            status,
            exactReadyKeys: record && keys.length === 6 && ['status', 'offerId', 'itemIds', 'matches', 'pageUrl', 'frameId'].every((key) => Object.hasOwn(value, key)),
            exactEmptyKeys: record && keys.length === 2 && ['status', 'itemIds'].every((key) => Object.hasOwn(value, key)),
            offerIdValid: record && typeof value.offerId === 'string' && /^[0-9a-f]{36}$/.test(value.offerId),
            itemIdsArray: record && Array.isArray(value.itemIds),
            itemCount: record && Array.isArray(value.itemIds) ? value.itemIds.length : null,
            uniqueItemCount: record && Array.isArray(value.itemIds) ? new Set(value.itemIds).size : null,
            matchesArray: record && Array.isArray(value.matches),
            matchCount: record && Array.isArray(value.matches) ? value.matches.length : null,
            frameIdValid: record && Number.isSafeInteger(value.frameId) && value.frameId >= 0,
            childFrame: record && Number.isSafeInteger(value.frameId) ? value.frameId > 0 : null,
            pageUrlPresent: record && typeof value.pageUrl === 'string',
            safePageUrl,
            normalizedPageUrl,
            pageUrlHasCredentials,
          };
        } catch {
          panelStatus = { requestSucceeded: false };
        }
        return { disposition: ${JSON.stringify(disposition)}, collected: true, ui, panelStatus };
      })()`);
    } catch {
      // The diagnostic must never replace the original acceptance failure.
    }
    if (proof) proof.preferencesQuietFillFailure = diagnostic;
    checkpoint('preferences_quiet_fill_diagnostic');
  };
  const fill = async () => {
    await verifyRealVaultPanel();
    const control = fillFor(targetName);
    try {
      await realPanel.waitFor('!!(' + control + ') && !(' + control + ').disabled', true, 15000);
    } catch {
      await recordQuietFillFailure('control_absent_or_disabled');
      throw new Error('preferences_quiet_fill_control_unavailable');
    }
    await realPanel.click(control);
    try {
      await realPanel.waitFor('Array.from(document.querySelectorAll("p")).some((node) => node.textContent?.trim() === "Filled. Review the form, then sign in.")', true, 15000);
    } catch {
      await recordQuietFillFailure('feedback_timeout_after_click');
      throw new Error('preferences_quiet_fill_feedback_timeout');
    }
  };
  try {
    receiptBefore = await snapshotOwnedReceiptState();
    assert(receiptSnapshotValid(receiptBefore), 'preferences_receipt_snapshot_invalid');
    checkpoint('preferences_open_fixture');
    const url = new URL(parentLoginUrl); url.searchParams.set('preferences', crypto.randomUUID());
    page = await context.newPage(); await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    tabId = await tabFor(worker, url.href, wait); await waitForBridge(worker, tabId, wait);
    await page.bringToFront(); await focusOwnedBrowser(tabId);
    await ensurePrivacyOpen(); originalMatching = await stateOf(SAVED_MATCHING); originalOnPage = await stateOf(ON_PAGE);
    await accessibility();
    checkpoint('preferences_keyboard_switch'); await keyboardSwitch();

    checkpoint('preferences_disable_saved_matching');
    await ensure(SAVED_MATCHING, false); await focusCredential(); await verifyRealVaultPanel();
    const disabledState = '(() => { const control = (' + fillFor(targetName) + '); const remedy = Array.from(document.querySelectorAll("p")).some((node) => node.textContent?.trim() === "Turn on saved-login matching in extension settings to use Fill."); return (!control || control.disabled) && remedy; })()';
    try { await realPanel.waitFor(disabledState, true, 15000); }
    catch { throw new Error('preferences_matching_disabled_panel_remedy_missing'); }
    await focusCredential();
    await stableAbsence(noOverlay, 'preferences_matching_disabled_overlay_present');
    evidence.matchingDisabledNoActionableFill = true; evidence.matchingDisabledNoOverlay = true;

    checkpoint('preferences_enable_quiet_fill');
    await ensure(SAVED_MATCHING, true); await ensure(ON_PAGE, false); await focusCredential();
    await stableAbsence(noOverlay, 'preferences_quiet_overlay_present');
    await fill();
    const filled = await page.evaluate(({ expectedUsername, expectedPassword }) => ({ username: document.querySelector('#email')?.value === expectedUsername, password: document.querySelector('#password')?.value === expectedPassword }), { expectedUsername: username, expectedPassword: password });
    assert(filled.username && filled.password, 'preferences_quiet_fill_values_mismatch');
    evidence.matchingEnabledQuietFill = true;

    checkpoint('preferences_enable_on_page');
    await ensure(ON_PAGE, true); await focusCredential();
    await page.locator('#matrx-inline-login-suggestion').waitFor({ state: 'attached', timeout: 15000 });
    await runVaultAccessibilityChecks({
      realPanel, context, fixturePage: page, targetName, assert, wait, checkpoint, proof,
      verifyRealVaultPanel, getSubmitCount, focusCredential,
    });
    await focusCredential();
    await page.locator('#matrx-inline-login-suggestion').waitFor({ state: 'attached', timeout: 15000 });
    await focusUnrelated();
    await page.locator('#matrx-inline-login-suggestion').waitFor({ state: 'detached', timeout: 15000 });
    evidence.onPageFocusedCredentialOnly = true;

    checkpoint('preferences_disable_on_page');
    await ensure(ON_PAGE, false); await focusCredential();
    await stableAbsence(noOverlay, 'preferences_on_page_disabled_overlay_present');
    assert(getSubmitCount() === baseline, 'preferences_submitted_website');
    evidence.onPageDisabledQuiet = true; evidence.noWebsiteSubmission = true;
  } catch (error) {
    primaryFailure = error;
  } finally {
    let restoreFailed = false;
    try {
      if (typeof originalMatching === 'boolean') await ensure(SAVED_MATCHING, originalMatching);
      if (typeof originalOnPage === 'boolean') await ensure(ON_PAGE, originalOnPage);
      evidence.settingsRestored = typeof originalMatching === 'boolean' && typeof originalOnPage === 'boolean'
        && (await stateOf(SAVED_MATCHING)) === originalMatching
        && (await stateOf(ON_PAGE)) === originalOnPage;
    } catch { restoreFailed = true; }
    try { if (page && !page.isClosed()) await page.close(); evidence.pageClosed = !!page && page.isClosed() === true; } catch { evidence.pageClosed = false; }
    try {
      const after = await snapshotOwnedReceiptState();
      evidence.receiptStateUnchanged = receiptSnapshotValid(receiptBefore) && receiptSnapshotValid(after)
        && canonicalReceipt(receiptBefore) === canonicalReceipt(after);
    } catch { evidence.receiptStateUnchanged = false; }
    if (proof) proof.preferences = evidence;
    if (!primaryFailure && (restoreFailed || !evidence.settingsRestored || !evidence.pageClosed)) primaryFailure = new Error('preferences_cleanup_failed');
  }
  if (primaryFailure) throw primaryFailure;
  assert(Object.values(evidence).every((value) => value === true), 'preferences_evidence_incomplete');
  return evidence;
};
exports._switchFor = switchFor;
