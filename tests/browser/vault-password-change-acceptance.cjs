'use strict';
const crypto = require('node:crypto');

/** Keep failure receipts structural: no candidate IDs, login names, or values. */
function captureDiagnostic(value) {
  const count = (candidate) =>
    Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
  return {
    snapshotUnavailable: value?.snapshotUnavailable === true,
    candidatePresent: value?.candidatePresent === true,
    candidateTabMatchesActive: value?.candidateTabMatchesActive === true,
    existingCount: count(value?.existingCount),
    searchControlPresent: value?.searchControlPresent === true,
    updateButtonCount: count(value?.updateButtonCount),
  };
}

async function recordCaptureDiagnostic(proof, inspectCaptureDiagnostic, tabId) {
  try {
    proof.passwordChangeDiagnostic = captureDiagnostic(await inspectCaptureDiagnostic(tabId));
  } catch {
    proof.passwordChangeDiagnostic = captureDiagnostic({ snapshotUnavailable: true });
  }
}

function renderPasswordChangeFixtureHTML(kind) {
  if (!['signup', 'change_password'].includes(kind))
    throw new Error('password_change_fixture_kind');
  const current =
    kind === 'change_password'
      ? '<label>Current password<input id="current" type="password" autocomplete="current-password"></label>'
      : '';
  return `<!doctype html><main><form method="post" action="/submitted"><label>Email<input id="email" type="email" autocomplete="username"></label>${current}<label>New password<input id="new" type="password" autocomplete="new-password"></label><label>Confirm password<input id="confirmation" type="password" autocomplete="new-password"></label><button id="submit" type="submit">${kind === 'signup' ? 'Create account' : 'Change password'}</button></form><script>document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();await fetch('/submitted',{method:'POST'});document.body.dataset.submitted='yes'})</script></main>`;
}

async function runPasswordChangeCaptureChecks({
  context,
  worker,
  realPanel,
  parentOrigin,
  targetName,
  username,
  currentPassword,
  nextPassword,
  assert,
  wait,
  checkpoint = () => {},
  proof,
  focusOwnedBrowser,
  verifyRealVaultPanel,
  pendingCard,
  waitForCaptureDecision,
  captureButton,
  pendingCapturePresent,
  getSubmitCount,
  getVaultWriteCount,
  snapshotOwnedReceiptState,
  verifySelectedUpdate,
  inspectCaptureDiagnostic,
}) {
  assert(
    new URL(parentOrigin).origin === parentOrigin && new URL(parentOrigin).hostname === '127.0.0.1',
    'password_change_origin',
  );
  const before = JSON.stringify(await snapshotOwnedReceiptState());
  const initialSubmits = getSubmitCount();
  const initialWrites = getVaultWriteCount();
  const evidence = {
    signupCaptured: false,
    signupDismissedWithoutWrite: false,
    changeCaptured: false,
    exactTargetUpdated: false,
    exactlyOneUpdateWrite: false,
    noExtraSubmission: false,
    noAdditionalFixture: false,
    pendingCleared: false,
    pagesClosed: false,
  };
  const pages = [];
  let failure;
  async function open(kind) {
    const page = await context.newPage();
    pages.push(page);
    const url = `${parentOrigin}/${kind === 'signup' ? 'signup' : 'change-password'}?case=${crypto.randomUUID()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    let tabId;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      tabId = await worker.evaluate(
        async (expected) => (await chrome.tabs.query({})).find((tab) => tab.url === expected)?.id,
        url,
      );
      if (Number.isInteger(tabId)) break;
      await wait(100);
    }
    assert(Number.isInteger(tabId), 'password_change_tab_missing');
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      ready = await worker.evaluate(
        async (id) =>
          (
            await chrome.scripting.executeScript({
              target: { tabId: id, frameIds: [0] },
              func: () => window.__matrx_bridge_mounted === true,
            })
          )[0]?.result === true,
        tabId,
      );
      if (ready) break;
      await wait(100);
    }
    assert(ready, 'password_change_bridge_missing');
    await page.bringToFront();
    await focusOwnedBrowser(tabId);
    assert(
      await worker.evaluate(async (id) => {
        const tab = await chrome.tabs.get(id),
          win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        return (
          tab.active && tab.windowId === win.id && win.focused === true && win.type === 'normal'
        );
      }, tabId),
      'password_change_window_focus',
    );
    return { page, tabId };
  }
  async function submit(page, kind, password) {
    await page.locator('#email').fill(username);
    if (kind === 'change_password') await page.locator('#current').fill(currentPassword);
    await page.locator('#new').fill(password);
    await page.locator('#confirmation').fill(password);
    assert(
      await page.evaluate(
        () => document.hasFocus() && document.activeElement?.id === 'confirmation',
      ),
      'password_change_document_focus',
    );
    await page.locator('#submit').click();
    await page.waitForFunction(() => document.body.dataset.submitted === 'yes');
    await verifyRealVaultPanel();
    await pendingCard();
  }
  try {
    checkpoint('signup_capture');
    const signup = await open('signup');
    await submit(signup.page, 'signup', `signup-${crypto.randomUUID()}`);
    assert(getSubmitCount() === initialSubmits + 1, 'signup_submit_count');
    evidence.signupCaptured = true;
    await realPanel.click(captureButton('Not now'));
    await waitForCaptureDecision();
    assert(
      getVaultWriteCount() === initialWrites && !(await pendingCapturePresent()),
      'signup_dismissal_mutated_vault',
    );
    assert(getSubmitCount() === initialSubmits + 1, 'signup_decision_submitted');
    evidence.signupDismissedWithoutWrite = true;

    checkpoint('password_change_capture');
    const change = await open('change_password');
    await submit(change.page, 'change_password', nextPassword);
    assert(getSubmitCount() === initialSubmits + 2, 'password_change_submit_count');
    evidence.changeCaptured = true;
    await recordCaptureDiagnostic(proof, inspectCaptureDiagnostic, change.tabId);
    await realPanel.fill(
      'document.querySelector(\'[aria-label="Search saved logins to update"]\')',
      targetName,
    );
    const button = captureButton(targetName, true);
    await realPanel.waitFor(`!!(${button}) && !(${button}).disabled`, true, 15000);
    await realPanel.click(button);
    await waitForCaptureDecision();
    assert(getVaultWriteCount() === initialWrites + 1, 'password_change_unexpected_write_count');
    evidence.exactlyOneUpdateWrite = true;
    assert(await verifySelectedUpdate(nextPassword), 'password_change_selected_update_failed');
    evidence.exactTargetUpdated = true;
    assert(getSubmitCount() === initialSubmits + 2, 'password_change_decision_submitted');
    evidence.noExtraSubmission = true;
    assert(!(await pendingCapturePresent()), 'password_change_candidate_retained');
    evidence.pendingCleared = true;
  } catch (error) {
    failure = error;
  } finally {
    const closed = await Promise.allSettled(
      pages.map(async (page) => {
        if (!page.isClosed()) await page.close();
        return page.isClosed();
      }),
    );
    evidence.pagesClosed = closed.every(
      (result) => result.status === 'fulfilled' && result.value === true,
    );
    evidence.noAdditionalFixture = JSON.stringify(await snapshotOwnedReceiptState()) === before;
    proof.passwordChange = evidence;
  }
  if (failure) throw failure;
  assert(
    Object.values(evidence).every((value) => value === true),
    'password_change_evidence_incomplete',
  );
  return evidence;
}
exports.renderPasswordChangeFixtureHTML = renderPasswordChangeFixtureHTML;
exports.runPasswordChangeCaptureChecks = runPasswordChangeCaptureChecks;
exports._captureDiagnostic = captureDiagnostic;
exports._recordCaptureDiagnostic = recordCaptureDiagnostic;
