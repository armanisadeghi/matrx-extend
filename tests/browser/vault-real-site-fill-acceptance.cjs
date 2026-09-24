'use strict';

/*
 * Real HTTPS Fill acceptance for the AI Matrx test identity. The caller owns
 * the receipt-backed ephemeral Vault item and canonical deletion; this helper
 * only drives a real sign-in form and returns boolean evidence. Credentials
 * remain in process/page comparisons and never enter the proof, logs, or a
 * screenshot. It deliberately never submits the form.
 */

const LOGIN_ORIGIN = 'https://www.aimatrx.com';
const LOGIN_PATH = '/login';
const POST_FILL_SETTLE_MS = 2_000;

function validateRealSiteUrls(realLoginUrl, wrongSiteUrl) {
  const login = new URL(realLoginUrl);
  const wrong = new URL(wrongSiteUrl);
  if (login.origin !== LOGIN_ORIGIN || login.pathname !== LOGIN_PATH || login.search || login.hash)
    throw new Error('real_site_login_url_refused');
  // The wrong-origin control is an existing owned localhost login form. This
  // verifies the old offer is refused without sending the real credential pair
  // to another HTTPS site or relying on a same-origin navigation difference.
  if (wrong.protocol !== 'http:' || wrong.hostname !== '127.0.0.1' || wrong.origin === LOGIN_ORIGIN)
    throw new Error('real_site_wrong_url_refused');
  return { login: login.href, wrong: wrong.href };
}

const exactFillButton = (targetName) => `(() => {
  const cards = Array.from(document.querySelectorAll('li')).filter((card) =>
    card.querySelector('span')?.textContent?.trim() === ${JSON.stringify(targetName)});
  if (cards.length !== 1) return null;
  const buttons = Array.from(cards[0].querySelectorAll('button')).filter((button) =>
    button.textContent?.trim() === 'Fill' && !button.disabled);
  return buttons.length === 1 ? buttons[0] : null;
})()`;

async function tabFor(worker, url, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tabId = await worker.evaluate(async (expectedUrl) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === expectedUrl)?.id,
    url);
    if (Number.isInteger(tabId)) return tabId;
    await wait(100);
  }
  throw new Error('real_site_fill_tab_missing');
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
  throw new Error('real_site_fill_bridge_not_ready');
}

async function waitForFocusedWrongOriginNoMatch({ page, realPanel, tabId, wrongUrl, wait, verifyRealVaultPanel }) {
  const deadline = Date.now() + 15_000;
  do {
    const pageReady = await page.evaluate((expectedUrl) => ({
      exactUrl: location.href === expectedUrl,
      focusedPassword: document.hasFocus() && document.activeElement?.id === 'password',
    }), wrongUrl);
    await verifyRealVaultPanel();
    const panelStatus = await realPanel.evaluate(async (id) => {
      try {
        const value = await chrome.runtime.sendMessage({
          __matrx: true,
          kind: 'credential-suggestions:panel-status',
          payload: { tabId: id },
        });
        const record = !!value && typeof value === 'object' && !Array.isArray(value);
        const keys = record ? Object.keys(value).sort() : [];
        return {
          status: record && typeof value.status === 'string' ? value.status : null,
          exactNoMatchShape: keys.length === 2 && keys[0] === 'itemIds' && keys[1] === 'status'
            && Array.isArray(value.itemIds) && value.itemIds.length === 0,
        };
      } catch {
        return { status: null, exactNoMatchShape: false };
      }
    }, tabId);
    if (pageReady.exactUrl && pageReady.focusedPassword
      && panelStatus.status === 'none' && panelStatus.exactNoMatchShape) return;
    await wait(100);
  } while (Date.now() < deadline);
  throw new Error('real_site_wrong_site_not_settled');
}

function observePostFillSubmission(page) {
  const observed = { navigationRequest: false, nonReadRequest: false, mainFrameNavigation: false };
  const onRequest = (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) observed.navigationRequest = true;
    if (!['GET', 'HEAD'].includes(request.method())) observed.nonReadRequest = true;
  };
  const onFrameNavigated = (frame) => {
    if (frame === page.mainFrame()) observed.mainFrameNavigation = true;
  };
  page.on('request', onRequest);
  page.on('framenavigated', onFrameNavigated);
  return {
    observed,
    stop: () => {
      page.off('request', onRequest);
      page.off('framenavigated', onFrameNavigated);
    },
  };
}

exports.runRealSiteFillChecks = async ({
  context, worker, realPanel, targetName, username, password, realLoginUrl, wrongSiteUrl,
  assert, wait, checkpoint = () => {}, proof, focusOwnedBrowser, verifyRealVaultPanel,
}) => {
  assert(context && worker && realPanel, 'real_site_fill_context_missing');
  assert(typeof targetName === 'string' && targetName.length > 0, 'real_site_fill_target_missing');
  assert(typeof username === 'string' && username.length > 0 && typeof password === 'string' && password.length > 0,
    'real_site_fill_credentials_missing');
  assert(typeof assert === 'function' && typeof wait === 'function' && typeof focusOwnedBrowser === 'function'
    && typeof verifyRealVaultPanel === 'function', 'real_site_fill_controls_missing');
  const urls = validateRealSiteUrls(realLoginUrl, wrongSiteUrl);
  const evidence = proof.realSiteFill = {
    realHttpsLoginFormReady: false,
    exactSavedAccountFilled: false,
    noWebsiteSubmission: false,
    wrongSiteRefused: false,
    pageClosed: false,
  };
  let page;
  let primaryFailure;
  let stopPostFillObservation = () => {};
  try {
    checkpoint('real_site_fill_login_open');
    // OAuth setup may leave this disposable browser signed in to the website.
    // Its /login route redirects signed-in visitors, so restore a real login
    // form before testing Fill. Extension auth lives in extension storage.
    await context.clearCookies();
    evidence.ownedWebCookiesClearedBeforeLogin = true;
    page = await context.newPage();
    await page.goto(urls.login, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const tabId = await tabFor(worker, urls.login, wait);
    await waitForBridge(worker, tabId, wait);
    await page.bringToFront();
    await focusOwnedBrowser(tabId);
    await page.locator('#password').focus();
    await page.evaluate(() => {
      window.__matrxRealSiteSubmitCount = 0;
      document.addEventListener('submit', () => { window.__matrxRealSiteSubmitCount += 1; }, true);
    });
    const initial = await page.evaluate(() => ({
      formReady: document.querySelector('#email') instanceof HTMLInputElement
        && document.querySelector('#password') instanceof HTMLInputElement,
      focusedPassword: document.activeElement?.id === 'password',
      empty: (document.querySelector('#email')?.value ?? '') === ''
        && (document.querySelector('#password')?.value ?? '') === '',
    }));
    assert(initial.formReady && initial.focusedPassword && initial.empty, 'real_site_fill_form_not_ready');
    evidence.realHttpsLoginFormReady = true;
    await verifyRealVaultPanel();
    const fill = exactFillButton(targetName);
    await realPanel.waitFor(`!!(${fill})`, true, 15000);
    checkpoint('real_site_fill_panel_fill');
    const postFill = observePostFillSubmission(page);
    stopPostFillObservation = postFill.stop;
    await realPanel.click(fill);
    const deadline = Date.now() + 15000;
    let filled = false;
    do {
      const values = await page.evaluate(({ expectedUsername, expectedPassword, loginUrl }) => ({
        usernameMatches: document.querySelector('#email')?.value === expectedUsername,
        passwordMatches: document.querySelector('#password')?.value === expectedPassword,
        submitCount: window.__matrxRealSiteSubmitCount,
        unchangedUrl: location.href === loginUrl,
      }), { expectedUsername: username, expectedPassword: password, loginUrl: urls.login });
      if (values.usernameMatches && values.passwordMatches && values.submitCount === 0 && values.unchangedUrl) {
        filled = true;
        break;
      }
      await wait(Math.min(100, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    assert(filled && !postFill.observed.navigationRequest && !postFill.observed.nonReadRequest
      && !postFill.observed.mainFrameNavigation, 'real_site_fill_not_completed');
    const settleDeadline = Date.now() + POST_FILL_SETTLE_MS;
    do {
      await verifyRealVaultPanel();
      const settled = await page.evaluate(({ expectedUsername, expectedPassword, loginUrl }) => ({
        usernameMatches: document.querySelector('#email')?.value === expectedUsername,
        passwordMatches: document.querySelector('#password')?.value === expectedPassword,
        unchangedUrl: location.href === loginUrl,
        submitCount: window.__matrxRealSiteSubmitCount,
      }), { expectedUsername: username, expectedPassword: password, loginUrl: urls.login });
      assert(settled.usernameMatches && settled.passwordMatches && settled.unchangedUrl && settled.submitCount === 0
        && !postFill.observed.navigationRequest && !postFill.observed.nonReadRequest
        && !postFill.observed.mainFrameNavigation, 'real_site_fill_submitted_after_match');
      await wait(Math.min(100, Math.max(1, settleDeadline - Date.now())));
    } while (Date.now() < settleDeadline);
    stopPostFillObservation();
    stopPostFillObservation = () => {};
    evidence.exactSavedAccountFilled = true;
    evidence.noWebsiteSubmission = true;

    checkpoint('real_site_fill_wrong_site_refusal');
    await page.goto(urls.wrong, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const wrongTabId = await tabFor(worker, urls.wrong, wait);
    await waitForBridge(worker, wrongTabId, wait);
    await page.bringToFront();
    await focusOwnedBrowser(wrongTabId);
    await page.locator('#password').focus();
    await waitForFocusedWrongOriginNoMatch({
      page, realPanel, tabId: wrongTabId, wrongUrl: urls.wrong, wait, verifyRealVaultPanel,
    });
    await realPanel.waitFor(`!(${fill})`, true, 15000);
    const wrongResult = await page.evaluate(() => {
      const email = document.querySelector('#email');
      const password = document.querySelector('#password');
      return {
        submitCount: window.__matrxRealSiteSubmitCount ?? 0,
        emailEmpty: !(email instanceof HTMLInputElement) || email.value === '',
        passwordEmpty: !(password instanceof HTMLInputElement) || password.value === '',
      };
    });
    assert(
      wrongResult.submitCount === 0 && wrongResult.emailEmpty && wrongResult.passwordEmpty,
      'real_site_wrong_site_changed',
    );
    evidence.wrongSiteRefused = true;
  } catch (error) {
    primaryFailure = error;
  } finally {
    stopPostFillObservation();
    if (page && !page.isClosed()) await page.close().catch(() => {});
    evidence.pageClosed = !page || page.isClosed() === true;
    if (proof) proof.realSiteFill = evidence;
  }
  if (primaryFailure) throw primaryFailure;
  assert(Object.values(evidence).every((value) => value === true), 'real_site_fill_evidence_incomplete');
  return evidence;
};

exports.validateRealSiteUrls = validateRealSiteUrls;
exports.observePostFillSubmission = observePostFillSubmission;
