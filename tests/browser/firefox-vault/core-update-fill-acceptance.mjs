import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));


async function elementId(driver, selector) {
  const value = await driver.wdPost(driver.base, `/session/${driver.sessionId}/element`, { using: 'css selector', value: selector });
  const id = value?.[ELEMENT_KEY];
  assert.equal(typeof id, 'string', 'core_update_fill_element_missing');
  return id;
}
async function fill(driver, selector, value) {
  const id = await elementId(driver, selector);
  await driver.wdPost(driver.base, `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/clear`, {});
  await driver.wdPost(driver.base, `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/value`, { text: value, value: [...value] });
}
async function submit(driver, selector) {
  const id = await elementId(driver, selector);
  await driver.wdPost(driver.base, `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/click`, {});
}
async function waitForCount(read, expected, failure) {
  const until = Date.now() + 10_000;
  while (read() !== expected && Date.now() < until) await delay(50);
  assert.equal(read(), expected, failure);
}
async function waitForBridge(probeFixtureBridge, url) {
  const until = Date.now() + 15_000;
  while (!(await probeFixtureBridge(url))) {
    if (Date.now() >= until) throw new Error('core_update_fill_bridge_not_ready');
    await delay(100);
  }
}


async function exactUpdateSelector(adapter, targetName) {
  return adapter.waitFor((document, expectedName) => {
    const headings = [...document.querySelectorAll('p')].filter(node => node.textContent?.trim() === 'Save this login to your Vault?' && node.getBoundingClientRect().height > 0);
    if (headings.length !== 1) return null;
    let card = headings[0];
    for (let depth = 0; card && depth < 4; depth += 1, card = card.parentElement) {
      const buttons = [...card.querySelectorAll('button')].filter(button => button.textContent?.trim().startsWith('Update'));
      const matching = buttons.filter(button => button.textContent?.replace(/^Update\s*/, '').trim() === expectedName);
      if (buttons.length !== 1 || matching.length !== 1) continue;
      const parts = [];
      for (let node = matching[0]; node && node !== document.documentElement; node = node.parentElement) {
        const parent = node.parentElement; const index = parent ? [...parent.children].indexOf(node) + 1 : 0;
        if (index < 1) return null; parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      }
      return parts.length ? `html > ${parts.join(' > ')}` : null;
    }
    return null;
  }, [targetName]);
}

async function exactFillSelector(adapter, targetName) {
  return adapter.waitFor((document, expectedName) => {
    const cards = [...document.querySelectorAll('li')].filter(card => card.querySelector('span')?.textContent?.trim() === expectedName);
    if (cards.length !== 1) return null;
    const buttons = [...cards[0].querySelectorAll('button')].filter(button => button.textContent?.trim() === 'Fill' && !button.disabled);
    if (buttons.length !== 1) return null;
    const parts = [];
    for (let node = buttons[0]; node && node !== document.documentElement; node = node.parentElement) {
      const parent = node.parentElement; const index = parent ? [...parent.children].indexOf(node) + 1 : 0;
      if (index < 1) return null; parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    }
    return parts.length ? `html > ${parts.join(' > ')}` : null;
  }, [targetName]);
}

async function valuesMatch({ base, sessionId, wdPost }, username, password) {
  const value = await wdPost(base, `/session/${sessionId}/execute/sync`, {
    script: 'return { usernameMatches: document.querySelector("#username")?.value === arguments[0], passwordMatches: document.querySelector("#password")?.value === arguments[1] };',
    args: [username, password],
  });
  return value?.usernameMatches === true && value?.passwordMatches === true;
}

/**
 * Updates one receipt-owned item through the production capture card, then
 * fills that exact item on a fresh owned localhost page. The caller owns item
 * materialization and canonical receipt cleanup; no values enter proof data.
 */
export async function runFirefoxCoreUpdateFillChecks({
  adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext, probeFixtureBridge,
  ownedItemId, targetName, username, password, verifyOwnedItemValues, fixture, proof,
}) {
  assert.ok(adapter && typeof adapter.trustedClick === 'function' && typeof adapter.waitFor === 'function', 'core_update_fill_adapter_contract_invalid');
  assert.equal(typeof probeFixtureBridge, 'function', 'core_update_fill_bridge_contract_invalid');
  assert.equal(typeof verifyOwnedItemValues, 'function', 'core_update_fill_readback_contract_invalid');
  assert.equal(typeof ownedItemId, 'string', 'core_update_fill_owned_item_invalid');
  assert.equal(typeof targetName, 'string', 'core_update_fill_target_name_invalid');
  assert.ok(targetName.length > 0, 'core_update_fill_target_name_empty');
  assert.equal(typeof username, 'string', 'core_update_fill_username_invalid');
  assert.equal(typeof password, 'string', 'core_update_fill_password_invalid');
  assert.ok(fixture && typeof fixture.baseUrl === 'string' && fixture.state, 'core_update_fill_fixture_contract_invalid');


  let original = null; let updateTab = null; let fillTab = null; let primary; let cleanup;
  proof.coreUpdateFill = { ok: false, updateSubmittedOnce: false, exactUpdateChoiceVisible: false, trustedUpdateClicked: false, pendingRemoved: false, updatedValuesVerified: false, freshFillFocused: false, exactFillVisible: false, trustedFillClicked: false, filledExactValues: false, noExtraSubmission: false, updateTabClosed: false, fillTabClosed: false, originalWindowRestored: false, fixtureServerRetainedForSaveCleanup: false };
  const driver = { base, sessionId, wdPost };
  const nextPassword = `updated-${randomUUID()}`;
  try {
    await getContext('content');
    original = await wdGet(base, `/session/${sessionId}/window`);
    updateTab = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' }))?.handle;
    assert.equal(typeof updateTab, 'string', 'core_update_fill_update_tab_missing');
    await wdPost(base, `/session/${sessionId}/window`, { handle: updateTab });
    const updateUrl = new URL(`/update?case=${randomUUID()}`, fixture.baseUrl).href;
    await wdPost(base, `/session/${sessionId}/url`, { url: updateUrl });
    await waitForBridge(probeFixtureBridge, updateUrl);
    await fill(driver, '#username', username);
    await fill(driver, '#current-password', password);
    await fill(driver, '#new-password', nextPassword);
    await fill(driver, '#confirm-password', nextPassword);
    await submit(driver, 'button[type="submit"]');
    await waitForCount(() => fixture.state.updateSubmissions, 1, 'core_update_fill_update_submit_not_observed_once');
    proof.coreUpdateFill.updateSubmittedOnce = true;

    await getContext('chrome');
    await adapter.trustedClick('button[title="Vault"]', { outcome: document => document.querySelector('button[title="Vault"]')?.getAttribute('aria-selected') === 'true' });
    const updateSelector = await exactUpdateSelector(adapter, targetName);
    assert.equal(typeof updateSelector, 'string', 'core_update_fill_exact_update_choice_missing');
    proof.coreUpdateFill.exactUpdateChoiceVisible = true;
    await adapter.trustedClick(updateSelector, { outcome: document => ![...document.querySelectorAll('p')].some(node => node.textContent?.trim() === 'Save this login to your Vault?' && node.getBoundingClientRect().height > 0), timeoutMs: 15_000 });
    proof.coreUpdateFill.trustedUpdateClicked = true;
    proof.coreUpdateFill.pendingRemoved = true;
    assert.equal(fixture.state.updateSubmissions, 1, 'core_update_fill_update_choice_submitted_fixture');
    assert.equal(await verifyOwnedItemValues({ itemId: ownedItemId, username, password: nextPassword, pageUrl: updateUrl }), true, 'core_update_fill_updated_values_not_materialized');
    proof.coreUpdateFill.updatedValuesVerified = true;

    await getContext('content');
    fillTab = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' }))?.handle;
    assert.equal(typeof fillTab, 'string', 'core_update_fill_fill_tab_missing');
    await wdPost(base, `/session/${sessionId}/window`, { handle: fillTab });
    const fillUrl = new URL(`/fill?case=${randomUUID()}`, fixture.baseUrl).href;
    await wdPost(base, `/session/${sessionId}/url`, { url: fillUrl });
    await waitForBridge(probeFixtureBridge, fillUrl);
    const passwordId = await elementId(driver, '#password');
    await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(passwordId)}/click`, {});
    proof.coreUpdateFill.freshFillFocused = true;

    await getContext('chrome');
    await adapter.trustedClick('button[title="Vault"]', { outcome: document => document.querySelector('button[title="Vault"]')?.getAttribute('aria-selected') === 'true' });
    const fillSelector = await exactFillSelector(adapter, targetName);
    assert.equal(typeof fillSelector, 'string', 'core_update_fill_exact_fill_missing');
    proof.coreUpdateFill.exactFillVisible = true;
    await adapter.trustedClick(fillSelector, { outcome: document => [...document.querySelectorAll('p')].some(node => node.textContent?.trim() === 'Filled. Review the form, then sign in.'), timeoutMs: 15_000 });
    proof.coreUpdateFill.trustedFillClicked = true;
    await getContext('content');
    await wdPost(base, `/session/${sessionId}/window`, { handle: fillTab });
    assert.equal(await valuesMatch(driver, username, nextPassword), true, 'core_update_fill_filled_values_mismatch');
    proof.coreUpdateFill.filledExactValues = true;
    assert.equal(fixture.state.updateSubmissions, 1, 'core_update_fill_update_submission_changed');
    assert.equal(fixture.state.fillSubmissions, 0, 'core_update_fill_fill_submitted_fixture');
    assert.equal(fixture.state.submissions, 1, 'core_update_fill_original_submission_changed');
    proof.coreUpdateFill.noExtraSubmission = true;
  } catch (error) { primary = error; } finally {
    for (const [key, tab] of [['fillTabClosed', fillTab], ['updateTabClosed', updateTab]]) if (tab) try {
      await getContext('content'); await wdPost(base, `/session/${sessionId}/window`, { handle: tab }); await wdDelete(base, `/session/${sessionId}/window`);
      assert.equal((await wdGet(base, `/session/${sessionId}/window/handles`)).includes(tab), false, 'core_update_fill_fixture_tab_still_open'); proof.coreUpdateFill[key] = true;
    } catch (error) { cleanup ||= error; }
    if (original) try { await getContext('content'); await wdPost(base, `/session/${sessionId}/window`, { handle: original }); proof.coreUpdateFill.originalWindowRestored = true; } catch (error) { cleanup ||= error; }
    // The Save helper owns the shared fixture server and closes it only after
    // receipt freezing/persistence; this journey must not close it early.
    proof.coreUpdateFill.fixtureServerRetainedForSaveCleanup = true;
  }
  if (primary) throw primary;
  if (cleanup) throw cleanup;
  const evidence = proof.coreUpdateFill;
  evidence.ok = evidence.updateSubmittedOnce && evidence.exactUpdateChoiceVisible && evidence.trustedUpdateClicked && evidence.pendingRemoved && evidence.updatedValuesVerified && evidence.freshFillFocused && evidence.exactFillVisible && evidence.trustedFillClicked && evidence.filledExactValues && evidence.noExtraSubmission && evidence.updateTabClosed && evidence.fillTabClosed && evidence.originalWindowRestored && evidence.fixtureServerRetainedForSaveCleanup;
  assert.equal(evidence.ok, true, 'core_update_fill_evidence_incomplete');
  return evidence;
}
