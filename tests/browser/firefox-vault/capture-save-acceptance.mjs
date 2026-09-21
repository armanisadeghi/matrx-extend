import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { runFirefoxCoreUpdateFillChecks } from './core-update-fill-acceptance.mjs';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture() {
  const state = { submissions: 0, updateSubmissions: 0, fillSubmissions: 0, closed: false };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (request.method === 'POST' && pathname === '/submitted') { state.submissions += 1; response.writeHead(204).end(); return; }
    if (request.method === 'POST' && pathname === '/submitted/update') { state.updateSubmissions += 1; response.writeHead(204).end(); return; }
    if (request.method === 'POST' && pathname === '/submitted/fill') { state.fillSubmissions += 1; response.writeHead(204).end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    if (pathname === '/update') {
      response.end(`<!doctype html><form method="post" action="/submitted/update"><label>Username <input id="username" autocomplete="username"></label><label>Current password <input id="current-password" type="password" autocomplete="current-password"></label><label>New password <input id="new-password" type="password" autocomplete="new-password"></label><label>Confirm password <input id="confirm-password" type="password" autocomplete="new-password"></label><button type="submit">Change password</button></form><script>document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); void fetch('/submitted/update', {method:'POST'}); });</script>`);
      return;
    }
    if (pathname === '/fill') {
      response.end(`<!doctype html><form method="post" action="/submitted/fill"><label>Username <input id="username" autocomplete="username"></label><label>Password <input id="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form><script>document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); void fetch('/submitted/fill', {method:'POST'}); });</script>`);
      return;
    }
    response.end(`<!doctype html><form method="post" action="/submitted"><label>Username <input id="username" autocomplete="username"></label><label>Password <input id="password" type="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form><script>document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); void fetch('/submitted', {method:'POST'}); });</script>`);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string', 'capture_save_fixture_bind_failed');
  return { state, url: `http://127.0.0.1:${address.port}/login`, close: async () => {
    if (state.closed) return;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); state.closed = true;
  }};
}

async function elementId({ base, sessionId, wdPost }, selector) {
  const value = await wdPost(base, `/session/${sessionId}/element`, { using: 'css selector', value: selector });
  const id = value?.[ELEMENT_KEY]; assert.ok(typeof id === 'string', 'capture_save_element_missing'); return id;
}
async function fill(driver, selector, value) {
  const id = await elementId(driver, selector);
  await driver.wdPost(driver.base, `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/clear`, {});
  await driver.wdPost(driver.base, `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/value`, { text: value, value: [...value] });
}
async function waitForBridge(probe, url) {
  const until = Date.now() + 15_000;
  while (!(await probe(url))) { if (Date.now() >= until) throw new Error('capture_save_bridge_not_ready'); await delay(100); }
}
async function saveButton(adapter) {
  return adapter.waitFor(document => {
    const heading = [...document.querySelectorAll('p')].find(node => node.textContent?.trim() === 'Save this login to your Vault?' && node.getBoundingClientRect().height > 0);
    const card = heading?.parentElement?.parentElement?.parentElement;
    const buttons = [...card?.querySelectorAll('button') ?? []].filter(button => ['Save', 'Save as new'].includes(button.textContent?.trim()));
    if (buttons.length !== 1) return null;
    const path = [];
    for (let node = buttons[0]; node && node !== document.documentElement; node = node.parentElement) {
      const index = [...node.parentElement.children].indexOf(node) + 1;
      if (index < 1) return null;
      path.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    }
    return path.length > 0 ? `html > ${path.join(' > ')}` : null;
  });
}

function observedReceiptKeys(receipt) {
  assert.ok(receipt && Array.isArray(receipt.requests) && Array.isArray(receipt.responses) && Array.isArray(receipt.keys), 'capture_save_receipt_invalid');
  assert.ok(receipt.keys.every(key => typeof key === 'string'), 'capture_save_receipt_key_invalid');
  return [...new Set(receipt.keys)];
}

async function persistObservedReceipt({ receipt, persistOwnedCreateMutationKeys, persistedKeys, proof }) {
  const keys = observedReceiptKeys(receipt);
  const prior = Array.isArray(proof.ownedCreateMutationKeys) ? proof.ownedCreateMutationKeys : [];
  proof.ownedCreateMutationKeys = [...new Set([...prior, ...keys])];
  if (proof.ownedCreateMutationKeys.some(key => !persistedKeys.has(key))) {
    try {
      await persistOwnedCreateMutationKeys([...proof.ownedCreateMutationKeys]);
    } catch {
      throw new Error('capture_save_receipt_persist_failed');
    }
    for (const key of proof.ownedCreateMutationKeys) persistedKeys.add(key);
  }
  if (proof.ownedCreateMutationKeys.length > 0)
    proof.captureSave.receiptKeysPersisted = proof.ownedCreateMutationKeys.every(key => persistedKeys.has(key));
  return receipt;
}

export async function runFirefoxCaptureSaveCheck({ adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext, probeFixtureBridge, persistOwnedCreateMutationKeys, verifySavedLogin, coreUpdateFill, proof }) {
  assert.ok(adapter && typeof adapter.trustedClick === 'function' && typeof adapter.startVaultCreateReceiptObserver === 'function' && typeof adapter.readVaultCreateReceiptObserver === 'function' && typeof adapter.freezeVaultCreateReceiptObserver === 'function' && typeof adapter.disposeVaultCreateReceiptObserver === 'function', 'capture_save_adapter_contract_invalid');
  assert.equal(typeof persistOwnedCreateMutationKeys, 'function', 'capture_save_receipt_persist_contract_invalid');
  assert.equal(typeof verifySavedLogin, 'function', 'capture_save_readback_contract_invalid');
  if (coreUpdateFill !== undefined) {
    assert.ok(coreUpdateFill && typeof coreUpdateFill.targetName === 'string' && coreUpdateFill.targetName.length > 0 && typeof coreUpdateFill.verifyOwnedItemValues === 'function', 'capture_save_core_update_fill_contract_invalid');
  }
  const server = await fixture(); let original = null; let tab = null; let primary; let cleanup; let observerStarted = false;
  const persistedKeys = new Set();
  proof.captureSave = { ok: false, nativeFixtureSubmittedOnce: false, pendingPromptObserved: false, trustedSaveClicked: false, pendingRemoved: false, receiptKeysPersisted: false, fixtureTabClosed: false, originalWindowRestored: false, fixtureServerClosed: false, receiptObserverDisposed: false };
  try {
    await getContext('content'); original = await wdGet(base, `/session/${sessionId}/window`);
    tab = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' }))?.handle;
    assert.ok(typeof tab === 'string', 'capture_save_fixture_tab_missing'); await wdPost(base, `/session/${sessionId}/window`, { handle: tab });
    const url = `${server.url}?case=${randomUUID()}`; await wdPost(base, `/session/${sessionId}/url`, { url }); await waitForBridge(probeFixtureBridge, url);
    const username = `save-${randomUUID()}@example.invalid`;
    const password = `save-${randomUUID()}`;
    const driver = { base, sessionId, wdPost }; await fill(driver, '#username', username); await fill(driver, '#password', password);
    const submit = await elementId(driver, 'button[type="submit"]'); await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(submit)}/click`, {});
    const until = Date.now() + 10_000; while (server.state.submissions !== 1 && Date.now() < until) await delay(50);
    assert.equal(server.state.submissions, 1, 'capture_save_fixture_submit_not_observed_once'); proof.captureSave.nativeFixtureSubmittedOnce = true;
    await getContext('chrome'); await adapter.trustedClick('button[title="Vault"]', { outcome: document => document.querySelector('button[title="Vault"]')?.getAttribute('aria-selected') === 'true' });
    const selector = await saveButton(adapter); assert.ok(typeof selector === 'string', 'capture_save_button_missing'); proof.captureSave.pendingPromptObserved = true;
    await adapter.startVaultCreateReceiptObserver({ origin: 'https://server.app.matrxserver.com' }); observerStarted = true; proof.captureSave.receiptObserverStarted = true;
    await adapter.trustedClick(selector, { outcome: document => ![...document.querySelectorAll('p')].some(node => node.textContent?.trim() === 'Save this login to your Vault?' && node.getBoundingClientRect().height > 0), timeoutMs: 15_000 });
    proof.captureSave.trustedSaveClicked = true; proof.captureSave.pendingRemoved = true; assert.equal(server.state.submissions, 1, 'capture_save_choice_submitted_fixture');
    const receipt = await adapter.readVaultCreateReceiptObserver();
    await persistObservedReceipt({ receipt, persistOwnedCreateMutationKeys, persistedKeys, proof });
    const [request] = receipt.requests;
    const response = typeof request?.requestId === 'string'
      ? receipt.responses.find(entry => entry.requestId === request.requestId && entry.status >= 200 && entry.status < 300)
      : null;
    proof.captureSave.receipt = { requestCount: receipt.requests.length, keyCount: receipt.keys.length, responseStatus: response?.status ?? null };
    assert.equal(receipt.requests.length, 1, 'capture_save_create_request_count'); assert.equal(receipt.keys.length, 1, 'capture_save_idempotency_key_count'); assert.ok(response, 'capture_save_create_response_missing');
    const savedLogin = await verifySavedLogin({ username, password, pageUrl: url });
    proof.captureSave.savedValuesVerified = true;
    if (coreUpdateFill !== undefined) {
      assert.equal(typeof savedLogin?.itemId, 'string', 'capture_save_core_update_fill_item_missing');
      await runFirefoxCoreUpdateFillChecks({
        adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext, probeFixtureBridge,
        ownedItemId: savedLogin.itemId, targetName: coreUpdateFill.targetName, username, password,
        verifyOwnedItemValues: coreUpdateFill.verifyOwnedItemValues, fixture: { baseUrl: server.url, state: server.state }, proof,
      });
      proof.captureSave.coreUpdateFillCompleted = true;
    }
  } catch (error) { primary = error; } finally {
    let frozenReceiptPersisted = false;
    if (observerStarted) try {
      const frozenReceipt = await adapter.freezeVaultCreateReceiptObserver();
      assert.equal(frozenReceipt?.frozen, true, 'capture_save_receipt_not_frozen');
      await persistObservedReceipt({ receipt: frozenReceipt, persistOwnedCreateMutationKeys, persistedKeys, proof });
      frozenReceiptPersisted = true;
      if (proof.ownedCreateMutationKeys.length !== 1)
        cleanup ||= new Error('capture_save_idempotency_key_count');
    } catch (error) { cleanup ||= error; }
    if (observerStarted && frozenReceiptPersisted) try { const disposed = await adapter.disposeVaultCreateReceiptObserver(); proof.captureSave.receiptObserverDisposed = disposed.disposed === true; } catch (error) { cleanup ||= error; }
    if (tab) try { await getContext('content'); await wdPost(base, `/session/${sessionId}/window`, { handle: tab }); await wdDelete(base, `/session/${sessionId}/window`); assert.equal((await wdGet(base, `/session/${sessionId}/window/handles`)).includes(tab), false, 'capture_save_fixture_tab_still_open'); proof.captureSave.fixtureTabClosed = true; } catch (error) { cleanup ||= error; }
    if (original) try { await getContext('content'); await wdPost(base, `/session/${sessionId}/window`, { handle: original }); proof.captureSave.originalWindowRestored = true; } catch (error) { cleanup ||= error; }
    try { await server.close(); proof.captureSave.fixtureServerClosed = true; } catch (error) { cleanup ||= error; }
  }
  if (primary) throw primary; if (cleanup) throw cleanup;
  proof.captureSave.ok = proof.captureSave.nativeFixtureSubmittedOnce && proof.captureSave.pendingPromptObserved && proof.captureSave.trustedSaveClicked && proof.captureSave.pendingRemoved && proof.captureSave.savedValuesVerified && proof.captureSave.receiptKeysPersisted && proof.captureSave.fixtureTabClosed && proof.captureSave.originalWindowRestored && proof.captureSave.fixtureServerClosed && proof.captureSave.receiptObserverDisposed;
  assert.equal(proof.captureSave.ok, true, 'capture_save_evidence_incomplete'); return proof.captureSave;
}
