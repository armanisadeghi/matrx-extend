import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { runFirefoxCoreUpdateFillChecks } from './core-update-fill-acceptance.mjs';
import { runFirefoxMultiAccountChecks } from './multi-account-acceptance.mjs';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture() {
  const state = { submissions: 0, updateSubmissions: 0, fillSubmissions: 0, closed: false };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (request.method === 'POST' && pathname === '/submitted') {
      state.submissions += 1;
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'POST' && pathname === '/submitted/update') {
      state.updateSubmissions += 1;
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'POST' && pathname === '/submitted/fill') {
      state.fillSubmissions += 1;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    if (pathname === '/update') {
      response.end(
        `<!doctype html><form method="post" action="/submitted/update"><label>Username <input id="username" autocomplete="username"></label><label>Current password <input id="current-password" type="password" autocomplete="current-password"></label><label>New password <input id="new-password" type="password" autocomplete="new-password"></label><label>Confirm password <input id="confirm-password" type="password" autocomplete="new-password"></label><button type="submit">Change password</button></form><script>document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); void fetch('/submitted/update', {method:'POST'}); });</script>`,
      );
      return;
    }
    if (pathname === '/fill') {
      response.end(
        `<!doctype html><form method="post" action="/submitted/fill"><label>Username <input id="username" autocomplete="username"></label><label>Password <input id="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form><script>document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); void fetch('/submitted/fill', {method:'POST'}); });</script>`,
      );
      return;
    }
    response.end(
      `<!doctype html><form method="post" action="/submitted"><label>Username <input id="username" autocomplete="username"></label><label>Password <input id="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form><script>document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); void fetch('/submitted', {method:'POST'}); });</script>`,
    );
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'capture_save_fixture_bind_failed');
  return {
    state,
    url: `http://127.0.0.1:${address.port}/login`,
    close: async () => {
      if (state.closed) return;
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      state.closed = true;
    },
  };
}

async function elementId({ base, sessionId, wdPost }, selector) {
  const value = await wdPost(base, `/session/${sessionId}/element`, {
    using: 'css selector',
    value: selector,
  });
  const id = value?.[ELEMENT_KEY];
  assert.equal(typeof id, 'string', 'capture_save_element_missing');
  return id;
}
async function fill(driver, selector, value) {
  const id = await elementId(driver, selector);
  await driver.wdPost(
    driver.base,
    `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/clear`,
    {},
  );
  await driver.wdPost(
    driver.base,
    `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/value`,
    { text: value, value: [...value] },
  );
}
async function waitForBridge(probe, url) {
  const until = Date.now() + 15_000;
  while (!(await probe(url))) {
    if (Date.now() >= until) throw new Error('capture_save_bridge_not_ready');
    await delay(100);
  }
}
async function saveButton(adapter) {
  return adapter.waitFor((document) => {
    const heading = [...document.querySelectorAll('p')].find(
      (node) =>
        node.textContent?.trim() === 'Save this login to your Vault?' &&
        node.getBoundingClientRect().height > 0,
    );
    const card = heading?.parentElement?.parentElement?.parentElement;
    const buttons = [...(card?.querySelectorAll('button') ?? [])].filter((button) =>
      ['Save', 'Save as new'].includes(button.textContent?.trim()),
    );
    if (buttons.length !== 1) return null;
    const path = [];
    for (
      let node = buttons[0];
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const index = [...node.parentElement.children].indexOf(node) + 1;
      if (index < 1) return null;
      path.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    }
    return path.length ? `html > ${path.join(' > ')}` : null;
  });
}
function receiptKeys(receipt) {
  assert.ok(
    receipt &&
      Array.isArray(receipt.requests) &&
      Array.isArray(receipt.responses) &&
      Array.isArray(receipt.keys),
    'capture_save_receipt_invalid',
  );
  assert.ok(
    receipt.keys.every((key) => typeof key === 'string'),
    'capture_save_receipt_key_invalid',
  );
  return [...new Set(receipt.keys)];
}
async function persistReceipt({ receipt, persistOwnedCreateMutationKeys, persisted, proof }) {
  const keys = receiptKeys(receipt);
  const combined = [...new Set([...(proof.ownedCreateMutationKeys ?? []), ...keys])];
  proof.ownedCreateMutationKeys = combined;
  if (combined.some((key) => !persisted.has(key))) {
    try {
      await persistOwnedCreateMutationKeys(combined);
    } catch {
      throw new Error('capture_save_receipt_persist_failed');
    }
    combined.forEach((key) => persisted.add(key));
  }
  proof.captureSave.receiptKeysPersisted = combined.every((key) => persisted.has(key));
  return keys;
}

export async function runFirefoxCaptureSaveCheck({
  adapter,
  base,
  sessionId,
  wdPost,
  wdGet,
  wdDelete,
  getContext,
  probeFixtureBridge,
  persistOwnedCreateMutationKeys,
  verifySavedLogin,
  coreUpdateFill,
  multiAccount,
  proof,
}) {
  assert.ok(
    adapter &&
      typeof adapter.trustedClick === 'function' &&
      typeof adapter.startVaultCreateReceiptObserver === 'function' &&
      typeof adapter.readVaultCreateReceiptObserver === 'function' &&
      typeof adapter.freezeVaultCreateReceiptObserver === 'function' &&
      typeof adapter.disposeVaultCreateReceiptObserver === 'function',
    'capture_save_adapter_contract_invalid',
  );
  assert.equal(
    typeof persistOwnedCreateMutationKeys,
    'function',
    'capture_save_receipt_persist_contract_invalid',
  );
  assert.equal(typeof verifySavedLogin, 'function', 'capture_save_readback_contract_invalid');
  assert.ok(!(coreUpdateFill && multiAccount), 'capture_save_journey_combined');
  if (coreUpdateFill)
    assert.equal(
      typeof coreUpdateFill.verifyOwnedItemValues,
      'function',
      'capture_save_core_update_fill_contract_invalid',
    );
  if (multiAccount)
    assert.ok(
      multiAccount.selectedIndex === 1 && typeof multiAccount.verifyAccountValues === 'function',
      'capture_save_multi_account_contract_invalid',
    );
  const duplicateUsername = `save-${randomUUID()}@example.invalid`;
  const cases = multiAccount
    ? [0, 1, 2, 3].map((index) => ({
        username:
          index === 2
            ? null
            : index < 2
              ? duplicateUsername
              : `save-${randomUUID()}@example.invalid`,
        password: `save-${randomUUID()}`,
      }))
    : [{ username: `save-${randomUUID()}@example.invalid`, password: `save-${randomUUID()}` }];
  const server = await fixture();
  let original = null;
  let primary;
  let cleanup;
  let observerStarted = false;
  const persisted = new Set();
  const tabs = [];
  const saved = [];
  proof.captureSave = {
    ok: false,
    caseCount: cases.length,
    nativeFixtureSubmittedOnce: false,
    pendingPromptObserved: false,
    trustedSaveClicked: false,
    pendingRemoved: false,
    receiptKeysPersisted: false,
    fixtureTabsClosed: 0,
    originalWindowRestored: false,
    fixtureServerClosed: false,
    receiptObserverDisposed: false,
  };
  try {
    await getContext('content');
    original = await wdGet(base, `/session/${sessionId}/window`);
    for (const [index, account] of cases.entries()) {
      const tab = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' }))?.handle;
      assert.equal(typeof tab, 'string', 'capture_save_fixture_tab_missing');
      tabs.push(tab);
      await wdPost(base, `/session/${sessionId}/window`, { handle: tab });
      const url = `${server.url}?case=${randomUUID()}`;
      await wdPost(base, `/session/${sessionId}/url`, { url });
      await waitForBridge(probeFixtureBridge, url);
      const driver = { base, sessionId, wdPost };
      if (account.username !== null) await fill(driver, '#username', account.username);
      await fill(driver, '#password', account.password);
      const submit = await elementId(driver, 'button[type="submit"]');
      await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(submit)}/click`, {});
      const deadline = Date.now() + 10_000;
      while (server.state.submissions !== index + 1 && Date.now() < deadline) await delay(50);
      assert.equal(
        server.state.submissions,
        index + 1,
        'capture_save_fixture_submit_not_observed_once',
      );
      proof.captureSave.nativeFixtureSubmittedOnce = true;
      await getContext('chrome');
      await adapter.trustedClick('button[title="Vault"]', {
        outcome: (document) =>
          document.querySelector('button[title="Vault"]')?.getAttribute('aria-selected') === 'true',
      });
      const selector = await saveButton(adapter);
      assert.equal(typeof selector, 'string', 'capture_save_button_missing');
      proof.captureSave.pendingPromptObserved = true;
      if (!observerStarted) {
        await adapter.startVaultCreateReceiptObserver({
          origin: 'https://server.app.matrxserver.com',
        });
        observerStarted = true;
        proof.captureSave.receiptObserverStarted = true;
      }
      const before = await adapter.readVaultCreateReceiptObserver();
      const priorKeys = new Set(receiptKeys(before));
      const priorRequests = new Set(before.requests.map((request) => request.requestId));
      await adapter.trustedClick(selector, {
        outcome: (document) =>
          ![...document.querySelectorAll('p')].some(
            (node) =>
              node.textContent?.trim() === 'Save this login to your Vault?' &&
              node.getBoundingClientRect().height > 0,
          ),
        timeoutMs: 15_000,
      });
      proof.captureSave.trustedSaveClicked = true;
      proof.captureSave.pendingRemoved = true;
      const receipt = await adapter.readVaultCreateReceiptObserver();
      const keys = await persistReceipt({
        receipt,
        persistOwnedCreateMutationKeys,
        persisted,
        proof,
      });
      const newKeys = keys.filter((key) => !priorKeys.has(key));
      const requests = receipt.requests.filter((request) => !priorRequests.has(request.requestId));
      const response =
        requests.length === 1
          ? receipt.responses.find(
              (entry) =>
                entry.requestId === requests[0].requestId &&
                entry.status >= 200 &&
                entry.status < 300,
            )
          : null;
      assert.equal(newKeys.length, 1, 'capture_save_new_idempotency_key_count');
      assert.equal(requests.length, 1, 'capture_save_new_create_request_count');
      assert.ok(response, 'capture_save_new_create_response_missing');
      assert.equal(response.status, 201, 'capture_save_new_create_not_created');
      const savedLogin = await verifySavedLogin({
        createMutationKey: newKeys[0],
        username: account.username ?? '',
        password: account.password,
        pageUrl: url,
      });
      assert.equal(typeof savedLogin?.itemId, 'string', 'capture_save_readback_item_missing');
      saved.push({
        itemId: savedLogin.itemId,
        displayName: savedLogin.targetName,
        username: account.username ?? '',
        password: account.password,
      });
      await getContext('content');
      await wdPost(base, `/session/${sessionId}/window`, { handle: tab });
      await wdDelete(base, `/session/${sessionId}/window`);
      assert.equal(
        (await wdGet(base, `/session/${sessionId}/window/handles`)).includes(tab),
        false,
        'capture_save_fixture_tab_still_open',
      );
      proof.captureSave.fixtureTabsClosed += 1;
      await wdPost(base, `/session/${sessionId}/window`, { handle: original });
    }
    proof.captureSave.savedValuesVerified = true;
    if (coreUpdateFill)
      await runFirefoxCoreUpdateFillChecks({
        adapter,
        base,
        sessionId,
        wdPost,
        wdGet,
        wdDelete,
        getContext,
        probeFixtureBridge,
        ownedItemId: saved[0].itemId,
        targetName: saved[0].displayName,
        username: saved[0].username,
        password: saved[0].password,
        verifyOwnedItemValues: coreUpdateFill.verifyOwnedItemValues,
        fixture: { baseUrl: server.url, state: server.state },
        proof,
      });
    if (multiAccount) {
      const selected = saved[multiAccount.selectedIndex];
      await multiAccount.beforeUpdate?.({ selected });
      await runFirefoxMultiAccountChecks({
        adapter,
        base,
        sessionId,
        wdPost,
        wdGet,
        wdDelete,
        getContext,
        probeFixtureBridge,
        fixture: { baseUrl: server.url, state: server.state },
        accounts: saved,
        selectedIndex: multiAccount.selectedIndex,
        verifyAccountValues: multiAccount.verifyAccountValues,
        proof,
      });
      await multiAccount.afterUpdate?.();
    }
  } catch (error) {
    primary = error;
  } finally {
    let frozenPersisted = false;
    if (observerStarted)
      try {
        await getContext('chrome');
        const receipt = await adapter.freezeVaultCreateReceiptObserver();
        assert.equal(receipt?.frozen, true, 'capture_save_receipt_not_frozen');
        await persistReceipt({ receipt, persistOwnedCreateMutationKeys, persisted, proof });
        frozenPersisted = true;
        assert.equal(
          proof.ownedCreateMutationKeys.length,
          cases.length,
          'capture_save_idempotency_key_count',
        );
      } catch (error) {
        cleanup ||= error;
      }
    if (observerStarted && frozenPersisted)
      try {
        const disposed = await adapter.disposeVaultCreateReceiptObserver();
        proof.captureSave.receiptObserverDisposed = disposed.disposed === true;
      } catch (error) {
        cleanup ||= error;
      }
    for (const tab of tabs)
      if (tab)
        try {
          await getContext('content');
          const handles = await wdGet(base, `/session/${sessionId}/window/handles`);
          if (handles.includes(tab)) {
            await getContext('content');
            await wdPost(base, `/session/${sessionId}/window`, { handle: tab });
            await wdDelete(base, `/session/${sessionId}/window`);
          }
        } catch (error) {
          cleanup ||= error;
        }
    if (original)
      try {
        await getContext('content');
        await wdPost(base, `/session/${sessionId}/window`, { handle: original });
        proof.captureSave.originalWindowRestored = true;
      } catch (error) {
        cleanup ||= error;
      }
    try {
      await server.close();
      proof.captureSave.fixtureServerClosed = true;
    } catch (error) {
      cleanup ||= error;
    }
  }
  if (primary) throw primary;
  if (cleanup) throw cleanup;
  const e = proof.captureSave;
  e.ok =
    e.nativeFixtureSubmittedOnce &&
    e.pendingPromptObserved &&
    e.trustedSaveClicked &&
    e.pendingRemoved &&
    e.savedValuesVerified &&
    e.receiptKeysPersisted &&
    e.fixtureTabsClosed === cases.length &&
    e.originalWindowRestored &&
    e.fixtureServerClosed &&
    e.receiptObserverDisposed;
  assert.equal(e.ok, true, 'capture_save_evidence_incomplete');
  return e;
}
