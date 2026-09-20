/*
 * Displayless saved-login Fill helper. It owns only disposable localhost pages;
 * the calling runner owns authentication, Vault fixtures, receipts and cleanup.
 * Values supplied by the caller stay in process/page evaluation and never enter
 * the returned proof object, logs, screenshots or a message seam.
 */
const SAVED_LOGIN_FIXTURE_PATHS = Object.freeze({
  nested: '/saved-login-nested',
  external: '/saved-login-external',
});

function renderSavedLoginFixtureHTML(kind) {
  if (kind !== 'nested' && kind !== 'external') throw new Error('saved_login_fixture_kind_invalid');
  const external = kind === 'external';
  return `<!doctype html><html><body>
      <main><h1>Disposable saved-login ${kind} form</h1><x-saved-login-outer></x-saved-login-outer></main>
      <script>
        (() => {
          const outer = document.querySelector('x-saved-login-outer');
          const outerRoot = outer.attachShadow({ mode: 'open' });
          const inner = document.createElement('x-saved-login-inner');
          const root = inner.attachShadow({ mode: 'open' });
          outerRoot.append(inner);
          const form = document.createElement('form');
          form.id = 'saved-login-form'; form.method = 'post'; form.action = '/submitted';
          form.addEventListener('submit', (event) => { event.preventDefault(); fetch('/submitted', { method: 'POST' }); });
          const username = document.createElement('input');
          username.id = '${kind}-username'; username.type = 'email'; username.name = 'email'; username.autocomplete = 'username';
          const password = document.createElement('input');
          password.id = '${kind}-password'; password.type = 'password'; password.name = 'password'; password.autocomplete = 'current-password';
          const unrelated = document.createElement('input');
          unrelated.id = '${kind}-unrelated'; unrelated.type = 'text'; unrelated.value = 'owned-unrelated'; unrelated.setAttribute('aria-label', 'Unrelated field');
          if (${external ? 'true' : 'false'}) {
            root.append(form);
            username.setAttribute('form', form.id); password.setAttribute('form', form.id);
            root.append(username, password, unrelated);
          } else {
            form.append(username, password, unrelated); root.append(form);
          }
        })();
      </script>
    </body></html>`;
}

function fixtureUrlsForParent(parentLoginUrl, parentOrigin) {
  const login = new URL(parentLoginUrl);
  if (typeof parentOrigin !== 'string' || login.origin !== parentOrigin)
    throw new Error('saved_login_parent_origin_mismatch');
  const urls = Object.fromEntries(Object.entries(SAVED_LOGIN_FIXTURE_PATHS).map(([kind, pathname]) =>
    [kind, new URL(pathname, login.origin).href],
  ));
  if (Object.values(urls).some((url) => new URL(url).origin !== login.origin))
    throw new Error('saved_login_fixture_origin_mismatch');
  return urls;
}

const exactFillButton = (targetName) => `(() => {
  const cards = Array.from(document.querySelectorAll('li')).filter((card) =>
    card.querySelector('span')?.textContent?.trim() === ${JSON.stringify(targetName)});
  if (cards.length !== 1) return null;
  const buttons = Array.from(cards[0].querySelectorAll('button')).filter((button) =>
    button.textContent?.trim() === 'Fill');
  return buttons.length === 1 ? buttons[0] : null;
})()`;

// Never return page text, display names, URLs, field values, or errors.  This
// is enough to distinguish a matching/card readiness problem from a withheld
// or disabled Fill control after a production run fails.
const panelReadinessDiagnostics = (targetName) => `(() => {
  const cap = (value) => Math.min(99, value);
  const cards = Array.from(document.querySelectorAll('li'));
  const targetCards = cards.filter((card) =>
    card.querySelector('span')?.textContent?.trim() === ${JSON.stringify(targetName)});
  const fillButtons = cards.flatMap((card) => Array.from(card.querySelectorAll('button')))
    .filter((button) => button.textContent?.trim() === 'Fill');
  const targetFillButtons = targetCards.flatMap((card) => Array.from(card.querySelectorAll('button')))
    .filter((button) => button.textContent?.trim() === 'Fill');
  const hasKnownStatus = (value) => Array.from(document.querySelectorAll('p'))
    .some((node) => node.textContent?.trim() === value);
  return {
    panelPresent: document.querySelector('[role="tabpanel"]') !== null,
    cardCount: cap(cards.length),
    targetCardCount: cap(targetCards.length),
    fillButtonCount: cap(fillButtons.length),
    enabledFillButtonCount: cap(fillButtons.filter((button) => !button.disabled).length),
    disabledFillButtonCount: cap(fillButtons.filter((button) => button.disabled).length),
    targetFillButtonCount: cap(targetFillButtons.length),
    targetEnabledFillButtonCount: cap(targetFillButtons.filter((button) => !button.disabled).length),
    targetDisabledFillButtonCount: cap(targetFillButtons.filter((button) => button.disabled).length),
    knownStatus: {
      noSavedLoginForPage: hasKnownStatus('No saved login fills this page.'),
      fillFocusRequired: hasKnownStatus('Click the username or password box on the website, then choose Fill.'),
      savedLoginsUnavailable: hasKnownStatus('Saved logins are unavailable right now.'),
      matchingDisabled: hasKnownStatus('Turn on saved-login matching in extension settings to use Fill.'),
    },
  };
})()`;

async function waitForBridge(worker, tabId, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await worker.evaluate(async (id) => {
      const result = await chrome.scripting.executeScript({
        target: { tabId: id, frameIds: [0] },
        func: () => window.__matrx_bridge_mounted === true,
      });
      return result[0]?.result === true;
    }, tabId);
    if (ready) return;
    await wait(100);
  }
  throw new Error('saved_login_fixture_bridge_not_ready');
}

async function tabFor(worker, url, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tabId = await worker.evaluate(async (expectedUrl) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === expectedUrl)?.id,
    url);
    if (Number.isInteger(tabId)) return tabId;
    await wait(100);
  }
  throw new Error('saved_login_fixture_tab_missing');
}

/**
 * Runs production quiet-panel Fill twice: nested open roots and native
 * same-root external form controls. No synthetic offer, host request, or
 * replacement credential engine is introduced by this helper.
 */
/**
 * The parent owns the exact-origin fixture routes and the website submit
 * counter. The helper never reads or writes Vault data itself.
 */
exports.runSavedLoginChecks = async ({
  context,
  worker,
  realPanel,
  targetName,
  username,
  password,
  parentLoginUrl,
  parentOrigin,
  getSubmitCount,
  assert,
  wait,
  checkpoint = () => {},
  proof,
  focusOwnedBrowser,
  verifyRealVaultPanel,
}) => {
  assert(context && worker && realPanel, 'saved_login_helper_context_missing');
  assert(typeof targetName === 'string' && targetName.length > 0, 'saved_login_helper_target_missing');
  assert(typeof username === 'string' && username.length > 0, 'saved_login_helper_username_missing');
  assert(typeof password === 'string' && password.length > 0, 'saved_login_helper_password_missing');
  assert(typeof wait === 'function' && typeof assert === 'function', 'saved_login_helper_controls_missing');
  assert(typeof verifyRealVaultPanel === 'function', 'saved_login_helper_panel_verifier_missing');
  assert(typeof getSubmitCount === 'function', 'saved_login_helper_submit_counter_missing');

  // Resolve and reject an origin mismatch before creating any browser page.
  const fixtureUrls = fixtureUrlsForParent(parentLoginUrl, parentOrigin);
  const submitCountBaseline = getSubmitCount();
  assert(Number.isInteger(submitCountBaseline) && submitCountBaseline >= 0, 'saved_login_submit_counter_invalid');

  const evidence = {
    scope: 'quiet real side-panel Fill against disposable nested open-root and native external-form controls',
    nestedOpenRootFilled: false,
    sameRootExternalFormFilled: false,
    quietNoInlineLoginSuggestion: false,
    noWebsiteSubmission: false,
    pagesClosed: false,
  };
  let page;
  const ownedPages = new Set();
  let primaryFailure;
  try {
    const runCase = async (kind, url) => {
      checkpoint(`saved_login_${kind}_navigate`);
      page = await context.newPage();
      ownedPages.add(page);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const tabId = await tabFor(worker, url, wait);
      await waitForBridge(worker, tabId, wait);
      await page.bringToFront();
      if (typeof focusOwnedBrowser === 'function') await focusOwnedBrowser(tabId);
      const passwordId = `#${kind}-password`;
      const inner = page.locator('x-saved-login-outer').locator('x-saved-login-inner');
      await inner.locator(passwordId).focus();
      await verifyRealVaultPanel();
      checkpoint(`saved_login_${kind}_panel_ready`);
      const fill = exactFillButton(targetName);
      try {
        await realPanel.waitFor(`!!(${fill})`, true, 15000);
      } catch {
        evidence.readinessDiagnostics = await realPanel.evaluate(panelReadinessDiagnostics(targetName))
          .catch(() => ({ unavailable: true }));
        throw new Error(`saved_login_${kind}_panel_fill_not_ready`);
      }
      const quiet = await page.evaluate(() => !document.querySelector('#matrx-inline-login-suggestion'));
      assert(quiet, `saved_login_${kind}_inline_suggestion_present`);
      checkpoint(`saved_login_${kind}_panel_fill`);
      await realPanel.click(fill);
      const outcome = `Array.from(document.querySelectorAll('p')).some((node) => node.textContent?.trim() === 'Filled. Review the form, then sign in.')`;
      try {
        await realPanel.waitFor(outcome, true, 15000);
      } catch {
        throw new Error(`saved_login_${kind}_panel_fill_not_completed`);
      }
      const values = await page.evaluate(({ usernameId, passwordId, unrelatedId, expectedUsername, expectedPassword }) => {
        const root = document.querySelector('x-saved-login-outer')?.shadowRoot
          ?.querySelector('x-saved-login-inner')?.shadowRoot;
        return {
          usernameMatches: root?.querySelector(usernameId)?.value === expectedUsername,
          passwordMatches: root?.querySelector(passwordId)?.value === expectedPassword,
          unrelatedUnchanged: root?.querySelector(unrelatedId)?.value === 'owned-unrelated',
        };
      }, {
        usernameId: `#${kind}-username`, passwordId, unrelatedId: `#${kind}-unrelated`,
        expectedUsername: username, expectedPassword: password,
      });
      assert(values.usernameMatches && values.passwordMatches && values.unrelatedUnchanged, `saved_login_${kind}_values_mismatch`);
      assert(getSubmitCount() === submitCountBaseline, `saved_login_${kind}_submitted_website`);
      await page.close();
      page = null;
    };

    await runCase('nested', fixtureUrls.nested);
    evidence.nestedOpenRootFilled = true;
    await runCase('external', fixtureUrls.external);
    evidence.sameRootExternalFormFilled = true;
    evidence.quietNoInlineLoginSuggestion = true;
    assert(getSubmitCount() === submitCountBaseline, 'saved_login_submitted_website');
    evidence.noWebsiteSubmission = true;
    if (proof) proof.savedLoginFill = evidence;
    return evidence;
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanupFailures = [];
    for (const ownedPage of ownedPages) {
      let closed = false;
      try { closed = ownedPage.isClosed() === true; } catch (error) { cleanupFailures.push(error); }
      if (!closed) {
        try { await ownedPage.close(); } catch (error) { cleanupFailures.push(error); }
      }
      try {
        if (ownedPage.isClosed() !== true) cleanupFailures.push(new Error('saved_login_owned_page_not_closed'));
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    evidence.pagesClosed = cleanupFailures.length === 0;
    if (!evidence.pagesClosed) evidence.pageCleanupFailure = true;
    if (proof) proof.savedLoginFill = evidence;
    // A cleanup failure is itself the result when the interaction passed, but
    // it remains evidence only when a prior interaction error already exists.
    if (!evidence.pagesClosed && !primaryFailure) throw new Error('saved_login_helper_page_cleanup_failed');
  }
};

exports.renderSavedLoginFixtureHTML = renderSavedLoginFixtureHTML;
exports.fixtureUrlsForParent = fixtureUrlsForParent;
