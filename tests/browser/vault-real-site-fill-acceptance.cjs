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

function validateRealSiteUrls(realLoginUrl, wrongSiteUrl) {
  const login = new URL(realLoginUrl);
  const wrong = new URL(wrongSiteUrl);
  if (login.origin !== LOGIN_ORIGIN || login.pathname !== LOGIN_PATH || login.search || login.hash)
    throw new Error('real_site_login_url_refused');
  if (wrong.protocol !== 'https:' || wrong.origin !== LOGIN_ORIGIN || wrong.href === login.href)
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
  try {
    checkpoint('real_site_fill_login_open');
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
    assert(filled, 'real_site_fill_not_completed');
    evidence.exactSavedAccountFilled = true;
    evidence.noWebsiteSubmission = true;

    checkpoint('real_site_fill_wrong_site_refusal');
    await page.goto(urls.wrong, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const wrongTabId = await tabFor(worker, urls.wrong, wait);
    await waitForBridge(worker, wrongTabId, wait);
    await page.bringToFront();
    await focusOwnedBrowser(wrongTabId);
    await verifyRealVaultPanel();
    await realPanel.waitFor(`!(${fill})`, true, 15000);
    const wrongResult = await page.evaluate(() => ({
      submitCount: window.__matrxRealSiteSubmitCount ?? 0,
      noPasswordValue: !(document.querySelector('#password') instanceof HTMLInputElement)
        || document.querySelector('#password').value === '',
    }));
    assert(wrongResult.submitCount === 0 && wrongResult.noPasswordValue, 'real_site_wrong_site_changed');
    evidence.wrongSiteRefused = true;
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (page && !page.isClosed()) await page.close().catch(() => {});
    evidence.pageClosed = !page || page.isClosed() === true;
    if (proof) proof.realSiteFill = evidence;
  }
  if (primaryFailure) throw primaryFailure;
  assert(Object.values(evidence).every((value) => value === true), 'real_site_fill_evidence_incomplete');
  return evidence;
};

exports.validateRealSiteUrls = validateRealSiteUrls;
