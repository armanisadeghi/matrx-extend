/*
 * Real-browser capture-decision helper. It drives only owned localhost forms
 * and the installed side-panel UI: no synthetic capture envelopes, direct
 * preference writes, Vault item writes, or credential-bearing diagnostics.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const SETTLED_CAPTURE_BOUND_MS = 6_200; // 1.5s fallback + 4.6s retry budget.
const captureHeading =
  'Array.from(document.querySelectorAll("p")).find((node) => node.textContent?.trim() === "Save this login to your Vault?")';
const captureCard = `(${captureHeading})?.parentElement?.parentElement?.parentElement`;

function startFixture() {
  const state = { submits: 0 };
  const server = http.createServer((request, response) => {
    if (request.method === 'POST') {
      state.submits += 1;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(`<!doctype html><html><body>
      <main><h1>Disposable capture form</h1>
        <form id="capture-form" method="post" action="/submitted">
          <label>Email<input id="email" type="email" autocomplete="username"></label>
          <label>Password<input id="password" type="password" autocomplete="current-password"></label>
          <button type="submit">Sign in</button>
        </form>
      </main>
      <script>document.querySelector('#capture-form').addEventListener('submit', (event) => {
        event.preventDefault(); fetch('/submitted', { method: 'POST' });
      });</script>
    </body></html>`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('capture_fixture_address_unavailable')));
        return;
      }
      resolve({
        state,
        url: `http://127.0.0.1:${address.port}/login`,
        close: () =>
          new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

async function tabFor(worker, url, wait) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tabId = await worker.evaluate(
      async (expectedUrl) =>
        (await chrome.tabs.query({})).find((tab) => tab.url === expectedUrl)?.id,
      url,
    );
    if (Number.isInteger(tabId)) return tabId;
    await wait(100);
  }
  throw new Error('capture_fixture_tab_missing');
}

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
  throw new Error('capture_fixture_bridge_not_ready');
}

/**
 * Exercises production capture decisions before any Vault fixture writes.
 * `vaultWriteCount` returns the caller's journal count of actual Vault writes
 * only. Read-only routes, including browser-login matching, are excluded by
 * the caller's route classifier. This helper never observes Vault values,
 * rows, or preference storage.
 */
exports.runCaptureDecisionChecks = async ({
  context,
  worker,
  realPanel,
  assert,
  wait,
  checkpoint = () => {},
  proof,
  focusOwnedBrowser,
  verifyRealVaultPanel,
  vaultWriteCount,
  pendingCapturePresent,
}) => {
  assert(context && worker && realPanel, 'capture_decision_helper_context_missing');
  assert(
    typeof assert === 'function' && typeof wait === 'function',
    'capture_decision_helper_controls_missing',
  );
  assert(
    typeof verifyRealVaultPanel === 'function',
    'capture_decision_helper_panel_verifier_missing',
  );
  assert(typeof vaultWriteCount === 'function', 'capture_decision_helper_write_counter_missing');
  assert(
    typeof pendingCapturePresent === 'function',
    'capture_decision_pending_capture_callback_missing',
  );

  const evidence = {
    scope: 'real localhost capture decisions through genuine side panel without Vault writes',
    notNowDismissed: false,
    sameOriginPromptAfterNotNow: false,
    neverDismissed: false,
    sameOriginSuppressedAfterNever: false,
    otherOriginPromptWhileNeverActive: false,
    askAgainControlObserved: false,
    askAgainClicked: false,
    sameOriginPromptAfterAskAgain: false,
    finalPendingDismissed: false,
    noVaultWriteRequests: false,
    fixtureServersClosed: false,
    pagesClosed: false,
  };
  let fixtureA;
  let fixtureB;
  const pages = new Set();
  let initialVaultWriteCount;

  const cardVisible = () =>
    realPanel.evaluate(
      `!!(${captureHeading}) && (${captureHeading}).getBoundingClientRect().height > 0`,
    );
  const waitForCard = async (code) => {
    await verifyRealVaultPanel();
    try {
      await realPanel.waitFor(
        `!!(${captureHeading}) && (${captureHeading}).getBoundingClientRect().height > 0`,
        true,
        15_000,
      );
    } catch {
      throw new Error(code);
    }
  };
  const waitForNoCard = async (code) => {
    try {
      await realPanel.waitFor(`!!(${captureHeading})`, false, 10_000);
    } catch {
      throw new Error(code);
    }
  };
  const assertMutationFree = async (code) => {
    const current = await vaultWriteCount();
    assert(Number.isInteger(current) && current === initialVaultWriteCount, code);
  };
  const assertPendingDraftErased = async (code) => {
    const present = await pendingCapturePresent();
    assert(present === false, code);
  };
  const submit = async (fixture, label) => {
    const page = await context.newPage();
    pages.add(page);
    // A distinct URL per submit avoids selecting a retained earlier tab while
    // preserving the fixture's exact origin for Never-suppression coverage.
    const pageUrl = `${fixture.url}?case=${crypto.randomUUID()}`;
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    const tabId = await tabFor(worker, pageUrl, wait);
    await waitForBridge(worker, tabId, wait);
    await page.bringToFront();
    if (typeof focusOwnedBrowser === 'function') await focusOwnedBrowser(tabId);
    const beforeSubmits = fixture.state.submits;
    // Values are process-random, typed through the real page, and are never
    // returned, logged, persisted, or used in any assertion output.
    await page.locator('#email').fill(`${label}-${crypto.randomUUID()}@example.invalid`);
    await page.locator('#password').fill(`capture-${crypto.randomUUID()}`);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    for (let attempt = 0; attempt < 40 && fixture.state.submits === beforeSubmits; attempt += 1)
      await wait(50);
    assert(fixture.state.submits === beforeSubmits + 1, 'capture_fixture_submit_not_observed');
    return { page, tabId };
  };
  const refreshPanelStatus = async (target) => {
    const alternate = await context.newPage();
    pages.add(alternate);
    await alternate.goto('about:blank');
    await alternate.bringToFront();
    await wait(100);
    await target.page.bringToFront();
    if (typeof focusOwnedBrowser === 'function') await focusOwnedBrowser(target.tabId);
    await verifyRealVaultPanel();
    await alternate.close();
    pages.delete(alternate);
  };
  const assertSettledSuppressed = async (target, code) => {
    await refreshPanelStatus(target);
    await wait(SETTLED_CAPTURE_BOUND_MS);
    await refreshPanelStatus(target);
    assert(!(await cardVisible()), code);
  };
  const clickNotNow = async (pendingCode) => {
    const control = `(${captureCard})?.querySelector('button[title="Not now"]')`;
    await realPanel.click(control);
    await waitForNoCard('capture_not_now_card_not_removed');
    await assertPendingDraftErased(pendingCode);
  };
  const clickNever = async () => {
    const control = `Array.from((${captureCard})?.querySelectorAll('button') || []).find((button) => button.textContent?.trim() === 'Never for this site')`;
    await realPanel.click(control);
    await waitForNoCard('capture_never_card_not_removed');
    await assertPendingDraftErased('capture_never_pending_draft_remaining');
  };
  const askAgain = async (fixture) => {
    checkpoint('capture_ask_again_settings');
    await realPanel.click('document.querySelector(`[title="Settings"]`)');
    const privacy = `Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Privacy')`;
    await realPanel.waitFor(`!!(${privacy})`);
    const privacyOpen = `(${privacy})?.parentElement?.nextElementSibling?.classList.contains('grid-rows-[1fr]') === true`;
    if (!(await realPanel.evaluate(privacyOpen))) await realPanel.click(privacy);
    await realPanel.waitFor(privacyOpen);
    const askAgainButton = `(() => {
      const originLabel = ${JSON.stringify(fixture.url.replace(/^https?:\/\//, '').replace(/\/login$/, ''))};
      const rows = Array.from(document.querySelectorAll('li')).filter((row) => row.querySelector('span')?.textContent?.trim() === originLabel);
      const buttons = rows.flatMap((row) => Array.from(row.querySelectorAll('button'))).filter((button) => button.textContent?.trim() === 'Ask again');
      return buttons.length === 1 ? buttons[0] : null;
    })()`;
    try {
      await realPanel.waitFor(`!!(${askAgainButton})`, true, 15_000);
    } catch {
      throw new Error('capture_ask_again_control_missing');
    }
    evidence.askAgainControlObserved = true;
    await realPanel.click(askAgainButton);
    evidence.askAgainClicked = true;
    try {
      await realPanel.waitFor(`!(${askAgainButton})`, true, 10_000);
    } catch {
      throw new Error('capture_ask_again_control_not_removed');
    }
    await verifyRealVaultPanel();
  };

  let primaryFailure;
  try {
    fixtureA = await startFixture();
    fixtureB = await startFixture();
    initialVaultWriteCount = await vaultWriteCount();
    assert(
      Number.isInteger(initialVaultWriteCount) && initialVaultWriteCount >= 0,
      'capture_decision_write_count_invalid',
    );
    checkpoint('capture_not_now_submit');
    const firstA = await submit(fixtureA, 'not-now');
    await waitForCard('capture_not_now_card_missing');
    await clickNotNow('capture_not_now_pending_draft_remaining');
    evidence.notNowDismissed = true;
    await assertMutationFree('capture_not_now_vault_write');

    checkpoint('capture_not_now_same_origin_positive');
    const replacementA = await submit(fixtureA, 'not-now-retry');
    await waitForCard('capture_not_now_same_origin_card_missing');
    evidence.sameOriginPromptAfterNotNow = true;

    checkpoint('capture_never_decision');
    await clickNever();
    evidence.neverDismissed = true;
    await assertMutationFree('capture_never_vault_write');

    checkpoint('capture_never_same_origin_negative');
    const suppressedA = await submit(fixtureA, 'never-suppressed');
    await assertSettledSuppressed(suppressedA, 'capture_never_same_origin_prompted');
    evidence.sameOriginSuppressedAfterNever = true;
    await assertMutationFree('capture_never_same_origin_vault_write');

    checkpoint('capture_never_other_origin_positive');
    const firstB = await submit(fixtureB, 'other-origin');
    await waitForCard('capture_never_other_origin_card_missing');
    evidence.otherOriginPromptWhileNeverActive = true;
    await clickNotNow('capture_other_origin_pending_draft_remaining');
    await assertMutationFree('capture_other_origin_vault_write');

    await askAgain(fixtureA);
    checkpoint('capture_ask_again_same_origin_positive');
    const recoveredA = await submit(fixtureA, 'ask-again-recovery');
    await waitForCard('capture_ask_again_same_origin_card_missing');
    evidence.sameOriginPromptAfterAskAgain = true;
    await clickNotNow('capture_final_pending_draft_remaining');
    evidence.finalPendingDismissed = true;

    assert(
      fixtureA.state.submits === 4 && fixtureB.state.submits === 1,
      'capture_fixture_submit_count_unexpected',
    );
    await assertMutationFree('capture_decisions_vault_write');
    evidence.noVaultWriteRequests = true;
    void firstA;
    void replacementA;
    void firstB; // Keep case ownership explicit without persisting handles.
  } catch (error) {
    primaryFailure = error;
  } finally {
    try {
      const closedPages = await Promise.allSettled(
        [...pages].map(async (page) => {
          if (!page.isClosed()) await page.close();
          return page.isClosed() === true;
        }),
      );
      evidence.pagesClosed = closedPages.every(
        (result) => result.status === 'fulfilled' && result.value === true,
      );
    } finally {
      const fixtures = [fixtureA, fixtureB].filter(Boolean);
      const closed = await Promise.allSettled(fixtures.map((fixture) => fixture.close()));
      evidence.fixtureServersClosed = closed.every((result) => result.status === 'fulfilled');
      if (proof) proof.captureDecisions = evidence;
    }
  }
  const cleanupFailed = !evidence.pagesClosed || !evidence.fixtureServersClosed;
  if (primaryFailure) {
    if (cleanupFailed) {
      throw new AggregateError(
        [primaryFailure, new Error('capture_decision_cleanup_failed')],
        'capture_decision_failed_with_cleanup_failure',
      );
    }
    throw primaryFailure;
  }
  assert(
    evidence.pagesClosed && evidence.fixtureServersClosed,
    'capture_decision_cleanup_unverified',
  );
  return evidence;
};
