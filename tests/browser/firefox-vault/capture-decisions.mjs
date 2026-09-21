import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const SETTLED_CAPTURE_BOUND_MS = 6_200;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertDependencies({ adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext, probeFixtureBridge, proof }) {
  assert.ok(adapter && typeof adapter.evaluate === 'function' && typeof adapter.waitFor === 'function'
    && typeof adapter.trustedClick === 'function', 'capture_adapter_contract_invalid');
  assert.ok(typeof base === 'string' && base.startsWith('http'), 'capture_webdriver_base_invalid');
  assert.ok(typeof sessionId === 'string' && sessionId.length > 0, 'capture_webdriver_session_invalid');
  assert.equal(typeof wdPost, 'function', 'capture_webdriver_post_missing');
  assert.equal(typeof wdGet, 'function', 'capture_webdriver_get_missing');
  assert.equal(typeof wdDelete, 'function', 'capture_webdriver_delete_missing');
  assert.equal(typeof getContext, 'function', 'capture_context_helper_missing');
  assert.equal(typeof probeFixtureBridge, 'function', 'capture_bridge_probe_missing');
  assert.ok(proof && typeof proof === 'object' && !Array.isArray(proof), 'capture_proof_missing');
}

async function createFixture() {
  const state = { submissions: 0, requests: 0, closed: false };
  const server = createServer((request, response) => {
    state.requests += 1;
    if (request.method === 'POST' && request.url === '/submitted') {
      state.submissions += 1;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><meta charset="utf-8"><title>Disposable capture fixture</title>
      <form method="post" action="/submitted">
        <label>Username <input id="username" type="email" autocomplete="username"></label>
        <label>Password <input id="password" type="password" autocomplete="current-password"></label>
        <button type="submit">Sign in</button>
      </form><script>document.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault(); void fetch('/submitted', { method: 'POST' });
      });</script>`);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string' && Number.isInteger(address.port), 'capture_fixture_bind_failed');
  return {
    url: `http://127.0.0.1:${address.port}/login`, state,
    async close() {
      if (state.closed) return;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      state.closed = true;
    },
  };
}

async function elementId({ base, sessionId, wdPost }, selector) {
  const element = await wdPost(base, `/session/${sessionId}/element`, { using: 'css selector', value: selector });
  const id = element?.[ELEMENT_KEY];
  assert.ok(typeof id === 'string' && id.length > 0, 'capture_fixture_element_missing');
  return id;
}

async function fillNative(driver, selector, value) {
  const id = await elementId(driver, selector);
  await driver.wdPost(driver.base, `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/clear`, {});
  await driver.wdPost(driver.base, `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/value`, { text: value, value: [...value] });
}

async function waitForFixtureBridge(probeFixtureBridge, fixtureUrl) {
  const deadline = Date.now() + 15_000;
  while (true) {
    const mounted = await probeFixtureBridge(fixtureUrl);
    if (mounted === true) return;
    if (Date.now() >= deadline) throw new Error('capture_fixture_bridge_not_ready');
    await delay(Math.min(100, deadline - Date.now()));
  }
}

async function pendingPromptDiagnostic(adapter) {
  return adapter.evaluate(document => {
    const headings = [...document.querySelectorAll('p')]
      .filter((node) => node.textContent?.trim() === 'Save this login to your Vault?');
    const visibleHeadings = headings.filter((node) => node.getBoundingClientRect().height > 0);
    const card = visibleHeadings.length === 1
      ? visibleHeadings[0].parentElement?.parentElement?.parentElement
      : null;
    return {
      vaultSelected: document.querySelector('button[title="Vault"]')?.getAttribute('aria-selected') === 'true',
      captureHeadingCount: headings.length,
      visibleCaptureHeadingCount: visibleHeadings.length,
      cardNotNowControlCount: card ? card.querySelectorAll('button[title="Not now"]').length : 0,
      panelBusyControlCount: document.querySelectorAll('button:disabled').length,
    };
  });
}

async function ensureVault(adapter) {
  await adapter.trustedClick('button[title="Vault"]', {
    outcome: document => document.querySelector('button[title="Vault"]')?.getAttribute('aria-selected') === 'true'
      && !!document.querySelector('[role="tabpanel"]'),
  });
}

async function assertSettledNoCapture(adapter) {
  const deadline = Date.now() + SETTLED_CAPTURE_BOUND_MS;
  while (true) {
    const visible = await adapter.evaluate(document => [...document.querySelectorAll('p')]
      .some((node) => node.textContent?.trim() === 'Save this login to your Vault?' && node.getBoundingClientRect().height > 0));
    assert.equal(visible, false, 'capture_prompt_reappeared_after_dismissal');
    if (Date.now() >= deadline) return;
    await delay(Math.min(100, deadline - Date.now()));
  }
}

export async function runFirefoxCaptureDecisionChecks(dependencies) {
  assertDependencies(dependencies);
  const { adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext, probeFixtureBridge, proof } = dependencies;
  const driver = { base, sessionId, wdPost };
  const fixture = await createFixture();
  let originalHandle = null;
  let tabHandle = null;
  let primaryFailure = null;
  let cleanupFailure = null;
  let workPassed = false;
  proof.captureDecisions = {
    ok: false,
    quietDefaultNoOverlay: false,
    fixtureBridgeMounted: false,
    nativeFixtureSubmittedOnce: false,
    pendingPromptObserved: false,
    dismissedThroughTrustedSidebarControl: false,
    pendingCaptureRemoved: false,
    noRepeatedPromptAfterSettling: false,
    noVaultSaveAction: false,
    fixtureSubmissions: 0,
    fixtureRequests: 0,
    tabClosed: false,
    originalWindowRestored: false,
    fixtureServerClosed: false,
  };
  try {
    await getContext('content');
    originalHandle = await wdGet(base, `/session/${sessionId}/window`);
    assert.ok(typeof originalHandle === 'string' && originalHandle.length > 0, 'capture_original_window_missing');
    tabHandle = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' }))?.handle;
    assert.ok(typeof tabHandle === 'string' && tabHandle.length > 0, 'capture_fixture_tab_missing');
    await wdPost(base, `/session/${sessionId}/window`, { handle: tabHandle });
    const fixtureUrl = `${fixture.url}?case=${randomUUID()}`;
    await wdPost(base, `/session/${sessionId}/url`, { url: fixtureUrl });
    await waitForFixtureBridge(probeFixtureBridge, fixtureUrl);
    proof.captureDecisions.fixtureBridgeMounted = true;

    await getContext('content');
    await fillNative(driver, '#username', `capture-${randomUUID()}@example.invalid`);
    await fillNative(driver, '#password', `capture-${randomUUID()}`);
    const quietDeadline = Date.now() + SETTLED_CAPTURE_BOUND_MS;
    while (true) {
      const quiet = await wdPost(base, `/session/${sessionId}/execute/sync`, {
        script: 'return document.hasFocus() && document.activeElement?.id === "password" && !document.querySelector("#matrx-inline-login-suggestion");', args: [],
      });
      assert.equal(quiet, true, 'capture_quiet_default_unsolicited_overlay');
      if (Date.now() >= quietDeadline) break;
      await delay(Math.min(100, quietDeadline - Date.now()));
    }
    proof.captureDecisions.quietDefaultNoOverlay = true;
    const submitId = await elementId(driver, 'button[type="submit"]');
    await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(submitId)}/click`, {});
    const submissionDeadline = Date.now() + 10_000;
    while (fixture.state.submissions !== 1 && Date.now() < submissionDeadline) await delay(50);
    assert.equal(fixture.state.submissions, 1, 'capture_fixture_submit_not_observed_once');
    proof.captureDecisions.nativeFixtureSubmittedOnce = true;

    await getContext('chrome');
    await ensureVault(adapter);
    let notNowSelector;
    try {
      notNowSelector = await adapter.waitFor(document => {
        const headings = [...document.querySelectorAll('p')]
          .filter((node) => node.textContent?.trim() === 'Save this login to your Vault?' && node.getBoundingClientRect().height > 0);
        if (headings.length !== 1) return null;
        const card = headings[0].parentElement?.parentElement?.parentElement;
        const controls = [...card?.querySelectorAll('button[title="Not now"]') ?? []];
        if (controls.length !== 1) return null;
        const path = [];
        for (let node = controls[0]; node && node !== document.documentElement; node = node.parentElement) {
          const index = [...node.parentElement.children].indexOf(node) + 1;
          if (index < 1) return null;
          path.unshift(`> ${node.tagName.toLowerCase()}:nth-child(${index})`);
        }
        return path.length > 0 ? `html ${path.join(' ')}` : null;
      }, [], { timeoutMs: 15_000 });
    } catch (error) {
      proof.captureDecisions.pendingPromptDiagnostic = await pendingPromptDiagnostic(adapter).catch(() => ({ collected: false }));
      throw error;
    }
    assert.ok(typeof notNowSelector === 'string' && notNowSelector.length > 0, 'capture_not_now_control_not_unique');
    proof.captureDecisions.pendingPromptObserved = true;
    await adapter.trustedClick(notNowSelector, {
      outcome: document => ![...document.querySelectorAll('p')]
        .some((node) => node.textContent?.trim() === 'Save this login to your Vault?' && node.getBoundingClientRect().height > 0),
    });
    proof.captureDecisions.dismissedThroughTrustedSidebarControl = true;
    await adapter.waitFor(document => ![...document.querySelectorAll('p')]
      .some((node) => node.textContent?.trim() === 'Save this login to your Vault?' && node.getBoundingClientRect().height > 0));
    proof.captureDecisions.pendingCaptureRemoved = true;
    assert.equal(fixture.state.submissions, 1, 'capture_dismissal_submitted_fixture');
    await assertSettledNoCapture(adapter);
    proof.captureDecisions.noRepeatedPromptAfterSettling = true;
    proof.captureDecisions.noVaultSaveAction = true;
    workPassed = true;
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (tabHandle) {
      try {
        await getContext('content');
        await wdPost(base, `/session/${sessionId}/window`, { handle: tabHandle });
        await wdDelete(base, `/session/${sessionId}/window`);
        const handles = await wdGet(base, `/session/${sessionId}/window/handles`);
        assert.equal(handles.includes(tabHandle), false, 'capture_fixture_tab_still_open');
        proof.captureDecisions.tabClosed = true;
      } catch (error) {
        if (!/no_such_window/i.test(String(error?.message))) cleanupFailure ||= error;
      }
    }
    if (originalHandle) {
      try {
        await getContext('content');
        const handles = await wdGet(base, `/session/${sessionId}/window/handles`);
        assert.equal(handles.includes(originalHandle), true, 'capture_original_window_missing_after_cleanup');
        await wdPost(base, `/session/${sessionId}/window`, { handle: originalHandle });
        assert.equal(await wdGet(base, `/session/${sessionId}/window`), originalHandle, 'capture_original_window_not_restored');
        proof.captureDecisions.originalWindowRestored = true;
      } catch (error) {
        cleanupFailure ||= error;
      }
    }
    try {
      await fixture.close();
    } catch (error) {
      cleanupFailure ||= error;
    }
    proof.captureDecisions.fixtureSubmissions = fixture.state.submissions;
    proof.captureDecisions.fixtureRequests = fixture.state.requests;
    proof.captureDecisions.fixtureServerClosed = fixture.state.closed;
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
  if (workPassed && proof.captureDecisions.tabClosed && proof.captureDecisions.originalWindowRestored
    && proof.captureDecisions.fixtureServerClosed)
    proof.captureDecisions.ok = true;
  assert.equal(proof.captureDecisions.ok, true, 'capture_decision_evidence_incomplete');
  return proof.captureDecisions;
}
