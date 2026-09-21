import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function idPrefix(itemId, itemIds) {
  for (let length = 1; length <= itemId.length; length += 1) {
    const prefix = itemId.slice(0, length);
    if (itemIds.filter((id) => id.startsWith(prefix)).length === 1) return prefix;
  }
  throw new Error('multi_account_id_prefix_not_unique');
}

function expectedUpdateTarget(account, itemIds) {
  return {
    primary: account.displayName,
    secondary: `ID ${idPrefix(account.itemId, itemIds)}`,
  };
}

async function elementId({ base, sessionId, wdPost }, selector) {
  const value = await wdPost(base, `/session/${sessionId}/element`, {
    using: 'css selector',
    value: selector,
  });
  const id = value?.[ELEMENT_KEY];
  assert.equal(typeof id, 'string', 'multi_account_element_missing');
  return id;
}

async function fill({ base, sessionId, wdPost }, selector, value) {
  const id = await elementId({ base, sessionId, wdPost }, selector);
  await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(id)}/clear`, {});
  await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(id)}/value`, {
    text: value,
    value: [...value],
  });
}

async function submit(driver) {
  const id = await elementId(driver, 'button[type="submit"]');
  await driver.wdPost(
    driver.base,
    `/session/${driver.sessionId}/element/${encodeURIComponent(id)}/click`,
    {},
  );
}

async function waitForCount(read, expected, code) {
  const deadline = Date.now() + 10_000;
  while (read() !== expected && Date.now() < deadline) await delay(50);
  assert.equal(read(), expected, code);
}

async function waitForBridge(probeFixtureBridge, url) {
  const deadline = Date.now() + 15_000;
  while (!(await probeFixtureBridge(url))) {
    if (Date.now() >= deadline) throw new Error('multi_account_bridge_not_ready');
    await delay(100);
  }
}

async function typeSearch(adapter, { base, sessionId, wdPost, wdDelete }, text) {
  const selector = '[aria-label="Search saved logins to update"]';
  await adapter.trustedClick(selector, {
    outcome: (document) =>
      document.activeElement?.getAttribute('aria-label') === 'Search saved logins to update',
  });
  await adapter.focusOwnedSidebar();
  try {
    await wdPost(base, `/session/${sessionId}/actions`, {
      actions: [
        {
          type: 'key',
          id: 'multi-account-search',
          actions: [...text].flatMap((value) => [
            { type: 'keyDown', value },
            { type: 'keyUp', value },
          ]),
        },
      ],
    });
  } finally {
    await wdDelete(base, `/session/${sessionId}/actions`);
  }
  await adapter.waitFor(
    (document, expected) =>
      document.querySelector('[aria-label="Search saved logins to update"]')?.value === expected,
    [text],
  );
}

/**
 * Serialization-safe predicate for adapter.waitFor. PendingCaptureCard renders
 * Update as a text node followed by primary and secondary spans, so do not
 * compare its collapsed textContent (which has no space before the dot).
 */
export function selectUpdateSelector(document, expected) {
  const heading = [...document.querySelectorAll('p')].filter(
    (node) =>
      node.textContent?.trim() === 'Save this login to your Vault?' &&
      node.getBoundingClientRect().height > 0,
  );
  if (heading.length !== 1) return null;
  const buttons = [...document.querySelectorAll('button')].filter((button) =>
    button.textContent?.trim().startsWith('Update'),
  );
  if (buttons.length !== 4) return null;
  const choices = buttons.map((button) => {
    const spans = [...button.querySelectorAll('span')];
    if (spans.length !== 2) return null;
    const primary = spans[0].textContent?.trim();
    const secondary = spans[1].textContent?.trim();
    if (!primary || secondary?.startsWith('· ') !== true) return null;
    return { button, primary, secondary: secondary.slice(2) };
  });
  if (choices.some((choice) => choice === null)) return null;
  const signatures = choices.map((choice) => `${choice.primary}\u0000${choice.secondary}`);
  const required = expected.map((choice) => `${choice.primary}\u0000${choice.secondary}`);
  if (new Set(signatures).size !== 4 || new Set(required).size !== 4) return null;
  if (required.length !== 4 || !required.every((signature) => signatures.includes(signature)))
    return null;
  const matching = choices.filter(
    (choice) =>
      choice.primary === expected[0].primary && choice.secondary === expected[0].secondary,
  );
  if (matching.length !== 1) return null;
  const parts = [];
  for (
    let node = matching[0].button;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    const parent = node.parentElement;
    const index = parent ? [...parent.children].indexOf(node) + 1 : 0;
    if (index < 1) return null;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
  }
  return parts.length ? `html > ${parts.join(' > ')}` : null;
}

/** Fixed-shape metadata only: never returns text, field values, or credential data. */
export function updateChoiceDiagnostic(document, expected) {
  const headings = [...document.querySelectorAll('p')].filter(
    (node) => node.textContent?.trim() === 'Save this login to your Vault?',
  );
  const updates = [...document.querySelectorAll('button')].filter((button) =>
    button.textContent?.trim().startsWith('Update'),
  );
  return {
    headingCount: headings.length,
    visibleHeadingCount: headings.filter((node) => node.getBoundingClientRect().height > 0).length,
    updateCount: updates.length,
    saveAsNewCount: [...document.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === 'Save as new',
    ).length,
    choices: updates.slice(0, 12).map((button) => {
      const spans = [...button.querySelectorAll('span')];
      return {
        spanCount: spans.length,
        disabled: button.disabled,
        primaryMatches: expected.map((target) => spans[0]?.textContent?.trim() === target.primary),
        secondaryMatches: expected.map(
          (target) => spans[1]?.textContent?.trim() === `· ${target.secondary}`,
        ),
      };
    }),
  };
}

async function updateSelector(adapter, targets, proof) {
  try {
    return await adapter.waitFor(selectUpdateSelector, [targets]);
  } catch (error) {
    try {
      proof.multiAccount.updateChoiceDiagnostic = await adapter.evaluate(updateChoiceDiagnostic, [
        targets,
      ]);
    } catch {
      proof.multiAccount.updateChoiceDiagnostic = { unavailable: true };
    }
    throw error;
  }
}

/** Serialization-safe exact selector for username-eligible VaultView Fill rows. */
export function selectEligibleFillSelector(document, expected) {
  if (!Array.isArray(expected) || expected.length !== 3) return null;
  const enabledFillRows = [...document.querySelectorAll('li')].filter((card) =>
    [...card.querySelectorAll('button')].some(
      (button) => button.textContent?.trim() === 'Fill' && !button.disabled,
    ),
  );
  if (enabledFillRows.length !== 3) return null;
  const cards = [...document.querySelectorAll('li')].filter((card) =>
    expected.includes(card.querySelector('span')?.textContent?.replace(/\s+/g, ' ').trim()),
  );
  const labels = cards.map((card) =>
    card.querySelector('span')?.textContent?.replace(/\s+/g, ' ').trim(),
  );
  if (
    cards.length !== 3 ||
    new Set(labels).size !== 3 ||
    !expected.every((label) => labels.includes(label))
  )
    return null;
  if (
    !cards.every(
      (card) =>
        [...card.querySelectorAll('button')].filter(
          (button) => button.textContent?.trim() === 'Fill' && !button.disabled,
        ).length === 1,
    )
  )
    return null;
  const chosen = cards.filter(
    (card) => card.querySelector('span')?.textContent?.replace(/\s+/g, ' ').trim() === expected[0],
  );
  if (chosen.length !== 1) return null;
  const button = [...chosen[0].querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Fill' && !candidate.disabled,
  );
  if (!button) return null;
  const parts = [];
  for (let node = button; node && node !== document.documentElement; node = node.parentElement) {
    const parent = node.parentElement;
    const index = parent ? [...parent.children].indexOf(node) + 1 : 0;
    if (index < 1) return null;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
  }
  return parts.length ? `html > ${parts.join(' > ')}` : null;
}

export function eligibleFillDiagnostic(document, expected) {
  const rows = [...document.querySelectorAll('li')];
  const fillRows = rows.filter((row) =>
    [...row.querySelectorAll('button')].some(
      (button) => button.textContent?.trim() === 'Fill' && !button.disabled,
    ),
  );
  const labels = fillRows.map(
    (row) => row.querySelector('span')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  );
  return {
    expectedCount: expected.length,
    fillRowCount: fillRows.length,
    uniqueLabelCount: new Set(labels).size,
    expectedLabelMatched: expected.map((label) => labels.includes(label)),
  };
}

async function exactFillSelector(adapter, expected, proof) {
  try {
    return await adapter.waitFor(selectEligibleFillSelector, [expected]);
  } catch (error) {
    try {
      proof.multiAccount.fillChoiceDiagnostic = await adapter.evaluate(eligibleFillDiagnostic, [
        expected,
      ]);
    } catch {
      proof.multiAccount.fillChoiceDiagnostic = { unavailable: true };
    }
    throw error;
  }
}

/**
 * Four receipt-owned accounts at one origin. The caller owns creation,
 * materialization and canonical cleanup. This helper never creates Vault data.
 */
export async function runFirefoxMultiAccountChecks({
  adapter,
  base,
  sessionId,
  wdPost,
  wdGet,
  wdDelete,
  getContext,
  probeFixtureBridge,
  fixture,
  accounts,
  selectedIndex,
  verifyAccountValues,
  afterUpdate,
  proof,
}) {
  assert.ok(
    adapter &&
      typeof adapter.trustedClick === 'function' &&
      typeof adapter.waitFor === 'function' &&
      typeof adapter.focusOwnedSidebar === 'function',
    'multi_account_adapter_contract_invalid',
  );
  assert.equal(typeof probeFixtureBridge, 'function', 'multi_account_bridge_contract_invalid');
  assert.equal(typeof verifyAccountValues, 'function', 'multi_account_readback_contract_invalid');
  if (afterUpdate !== undefined)
    assert.equal(typeof afterUpdate, 'function', 'multi_account_after_update_contract_invalid');
  assert.ok(
    fixture && typeof fixture.baseUrl === 'string' && fixture.state,
    'multi_account_fixture_contract_invalid',
  );
  assert.equal(accounts?.length, 4, 'multi_account_fixture_count_invalid');
  assert.ok(
    Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < accounts.length,
    'multi_account_selected_index_invalid',
  );
  assert.ok(
    accounts.every(
      (account) =>
        typeof account?.itemId === 'string' &&
        typeof account.displayName === 'string' &&
        typeof account.username === 'string' &&
        typeof account.password === 'string',
    ),
    'multi_account_metadata_invalid',
  );
  assert.equal(
    new Set(accounts.map((account) => account.itemId)).size,
    4,
    'multi_account_item_ids_not_unique',
  );
  assert.equal(
    new Set(accounts.map((account) => account.displayName)).size,
    1,
    'multi_account_duplicate_display_names_required',
  );
  assert.equal(fixture.state.submissions, 4, 'multi_account_four_saved_submissions_required');

  const selected = accounts[selectedIndex];
  const itemIds = accounts.map((account) => account.itemId);
  const fillAccounts = accounts.filter((account) => account.username.length > 0);
  const missingUsernameAccounts = accounts.filter((account) => account.username.length === 0);
  assert.equal(fillAccounts.length, 3, 'multi_account_fill_eligible_count_invalid');
  assert.equal(
    missingUsernameAccounts.length,
    1,
    'multi_account_missing_username_fixture_count_invalid',
  );
  assert.equal(
    fillAccounts.some((account) => account.itemId === missingUsernameAccounts[0].itemId),
    false,
    'multi_account_missing_username_fill_included',
  );
  assert.ok(
    fillAccounts.some((account) => account.itemId === selected.itemId),
    'multi_account_selected_fill_ineligible',
  );
  const fillItemIds = fillAccounts.map((account) => account.itemId);
  const labels = [
    expectedUpdateTarget(selected, itemIds),
    ...accounts
      .filter((_, index) => index !== selectedIndex)
      .map((account) => expectedUpdateTarget(account, itemIds)),
  ];
  const driver = { base, sessionId, wdPost };
  const nextPassword = `updated-${randomUUID()}`;
  let original = null;
  let updateTab = null;
  let fillTab = null;
  let primary;
  let cleanup;
  proof.multiAccount = {
    ok: false,
    fourSameSiteChoicesVisible: false,
    duplicateNamesHaveUniqueIdSuffixes: false,
    searchTypedNatively: false,
    selectedStableIdClicked: false,
    selectedValuesUpdated: false,
    unselectedValuesUnchanged: false,
    missingUsernameExcludedFromFill: false,
    freshFillFocused: false,
    fillStableIdExposed: false,
    exactFillClicked: false,
    exactValuesFilled: false,
    noExtraSubmission: false,
    updateTabClosed: false,
    fillTabClosed: false,
    originalWindowRestored: false,
  };
  try {
    await getContext('content');
    original = await wdGet(base, `/session/${sessionId}/window`);
    updateTab = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' }))?.handle;
    assert.equal(typeof updateTab, 'string', 'multi_account_update_tab_missing');
    await wdPost(base, `/session/${sessionId}/window`, { handle: updateTab });
    const updateUrl = new URL(`/update?case=${randomUUID()}`, fixture.baseUrl).href;
    await wdPost(base, `/session/${sessionId}/url`, { url: updateUrl });
    await waitForBridge(probeFixtureBridge, updateUrl);
    await fill(driver, '#username', selected.username);
    await fill(driver, '#current-password', selected.password);
    await fill(driver, '#new-password', nextPassword);
    await fill(driver, '#confirm-password', nextPassword);
    await submit(driver);
    await waitForCount(
      () => fixture.state.updateSubmissions,
      1,
      'multi_account_update_submit_not_observed_once',
    );

    await getContext('chrome');
    await adapter.trustedClick('button[title="Vault"]', {
      outcome: (document) =>
        document.querySelector('button[title="Vault"]')?.getAttribute('aria-selected') === 'true',
    });
    const selector = await updateSelector(adapter, labels, proof);
    assert.equal(typeof selector, 'string', 'multi_account_four_exact_update_choices_missing');
    proof.multiAccount.fourSameSiteChoicesVisible = true;
    proof.multiAccount.duplicateNamesHaveUniqueIdSuffixes = true;
    await typeSearch(adapter, { base, sessionId, wdPost, wdDelete }, selected.displayName);
    proof.multiAccount.searchTypedNatively = true;
    const searchedSelector = await updateSelector(adapter, labels, proof);
    await adapter.trustedClick(searchedSelector, {
      outcome: (document) =>
        ![...document.querySelectorAll('p')].some(
          (node) =>
            node.textContent?.trim() === 'Save this login to your Vault?' &&
            node.getBoundingClientRect().height > 0,
        ),
      timeoutMs: 15_000,
    });
    proof.multiAccount.selectedStableIdClicked = true;
    assert.equal(
      fixture.state.updateSubmissions,
      1,
      'multi_account_update_choice_submitted_fixture',
    );
    const values = await verifyAccountValues({
      selected,
      accounts,
      nextPassword,
      pageUrl: updateUrl,
    });
    assert.equal(values?.selectedUpdated, true, 'multi_account_selected_values_not_updated');
    assert.equal(values?.unselectedUnchanged, true, 'multi_account_unselected_values_changed');
    proof.multiAccount.selectedValuesUpdated = true;
    proof.multiAccount.unselectedValuesUnchanged = true;
    if (afterUpdate) {
      await afterUpdate();
      proof.multiAccount.authenticatorPreservedAfterUpdate = true;
    }

    await getContext('content');
    fillTab = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' }))?.handle;
    assert.equal(typeof fillTab, 'string', 'multi_account_fill_tab_missing');
    await wdPost(base, `/session/${sessionId}/window`, { handle: fillTab });
    const fillUrl = new URL(`/fill?case=${randomUUID()}`, fixture.baseUrl).href;
    await wdPost(base, `/session/${sessionId}/url`, { url: fillUrl });
    await waitForBridge(probeFixtureBridge, fillUrl);
    const passwordId = await elementId(driver, '#password');
    await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(passwordId)}/click`, {});
    proof.multiAccount.freshFillFocused = true;
    await getContext('chrome');
    await adapter.trustedClick('button[title="Vault"]', {
      outcome: (document) =>
        document.querySelector('button[title="Vault"]')?.getAttribute('aria-selected') === 'true',
    });
    const fillLabels = fillAccounts.map(
      (account) => `${account.displayName} · ID ${idPrefix(account.itemId, fillItemIds)}`,
    );
    const fillSelector = await exactFillSelector(
      adapter,
      [
        `${selected.displayName} · ID ${idPrefix(selected.itemId, fillItemIds)}`,
        ...fillLabels.filter(
          (label) =>
            label !== `${selected.displayName} · ID ${idPrefix(selected.itemId, fillItemIds)}`,
        ),
      ],
      proof,
    );
    assert.equal(typeof fillSelector, 'string', 'multi_account_exact_fill_choice_missing');
    proof.multiAccount.fillStableIdExposed = true;
    proof.multiAccount.missingUsernameExcludedFromFill = true;
    await adapter.trustedClick(fillSelector, {
      outcome: (document) =>
        [...document.querySelectorAll('p')].some(
          (node) => node.textContent?.trim() === 'Filled. Review the form, then sign in.',
        ),
      timeoutMs: 15_000,
    });
    proof.multiAccount.exactFillClicked = true;
    await getContext('content');
    await wdPost(base, `/session/${sessionId}/window`, { handle: fillTab });
    const filled = await wdPost(base, `/session/${sessionId}/execute/sync`, {
      script:
        'return document.querySelector("#username")?.value === arguments[0] && document.querySelector("#password")?.value === arguments[1];',
      args: [selected.username, nextPassword],
    });
    assert.equal(filled, true, 'multi_account_filled_values_mismatch');
    proof.multiAccount.exactValuesFilled = true;
    assert.equal(fixture.state.submissions, 4, 'multi_account_original_submissions_changed');
    assert.equal(fixture.state.updateSubmissions, 1, 'multi_account_update_submissions_changed');
    assert.equal(fixture.state.fillSubmissions, 0, 'multi_account_fill_submitted_form');
    proof.multiAccount.noExtraSubmission = true;
  } catch (error) {
    primary = error;
  } finally {
    for (const [key, tab] of [
      ['fillTabClosed', fillTab],
      ['updateTabClosed', updateTab],
    ])
      if (tab)
        try {
          await getContext('content');
          await wdPost(base, `/session/${sessionId}/window`, { handle: tab });
          await wdDelete(base, `/session/${sessionId}/window`);
          assert.equal(
            (await wdGet(base, `/session/${sessionId}/window/handles`)).includes(tab),
            false,
            'multi_account_fixture_tab_still_open',
          );
          proof.multiAccount[key] = true;
        } catch (error) {
          cleanup ||= error;
        }
    if (original)
      try {
        await getContext('content');
        await wdPost(base, `/session/${sessionId}/window`, { handle: original });
        proof.multiAccount.originalWindowRestored = true;
      } catch (error) {
        cleanup ||= error;
      }
  }
  if (primary) throw primary;
  if (cleanup) throw cleanup;
  proof.multiAccount.ok = Object.entries(proof.multiAccount).every(
    ([key, value]) => key === 'ok' || value === true,
  );
  assert.equal(proof.multiAccount.ok, true, 'multi_account_evidence_incomplete');
  return proof.multiAccount;
}
