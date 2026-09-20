import assert from 'node:assert/strict';
import { createServer } from 'node:http';

/*
 * Acceptance helper for an already-authenticated, already-owned Firefox
 * WebDriver session.  It deliberately owns only its localhost fixture and the
 * tab it opens.  The caller retains authentication, sidebar lifecycle, and
 * session teardown.
 *
 * `adapter` is the Firefox sidebar adapter from adapter.mjs. `getContext` must
 * select Marionette's `content` or `chrome` context. `wdPost`, `wdGet`, and
 * `wdDelete` are the driver's JSON Wire helpers, already bound to `base`.
 * The returned proof contains booleans and counts only; generated values never
 * leave this helper or appear in an assertion message.
 */

const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const GENERATOR = '[aria-label="Password generator"]';

const fixtureHtml = `<!doctype html>
<meta charset="utf-8">
<title>Disposable generator fixture</title>
<form method="post" action="/submitted">
  <label>Current password <input id="current" name="current" type="password" autocomplete="current-password" value="current-password-canary"></label>
  <label>New password <input id="new" name="new" type="password" autocomplete="new-password"></label>
  <label>Confirm password <input id="confirm" name="confirm" type="password" autocomplete="new-password"></label>
  <button type="submit">Submit fixture</button>
</form>`;

function assertHelperDependencies({ adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext }) {
  assert.ok(adapter && typeof adapter.evaluate === 'function' && typeof adapter.waitFor === 'function'
    && typeof adapter.trustedClick === 'function', 'generator_adapter_contract_invalid');
  assert.ok(typeof base === 'string' && base.startsWith('http'), 'generator_webdriver_base_invalid');
  assert.ok(typeof sessionId === 'string' && sessionId.length > 0, 'generator_webdriver_session_invalid');
  assert.equal(typeof wdPost, 'function', 'generator_webdriver_post_missing');
  assert.equal(typeof wdGet, 'function', 'generator_webdriver_get_missing');
  assert.equal(typeof wdDelete, 'function', 'generator_webdriver_delete_missing');
  assert.equal(typeof getContext, 'function', 'generator_context_helper_missing');
}

async function createFixtureServer() {
  const state = { requests: 0, submissions: 0, closed: false };
  const server = createServer((request, response) => {
    state.requests += 1;
    if (request.url === '/fixture' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(fixtureHtml);
      return;
    }
    if (request.url === '/submitted') {
      state.submissions += 1;
      response.writeHead(204).end();
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string' && Number.isInteger(address.port), 'generator_fixture_bind_failed');
  return {
    url: `http://127.0.0.1:${address.port}/fixture`,
    state,
    async close() {
      if (state.closed) return;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      state.closed = true;
    },
  };
}

async function sidebarButton(adapter, label) {
  const selector = await adapter.waitFor((document, rootSelector, exactLabel) => {
    const root = document.querySelector(rootSelector);
    if (!root) return null;
    const matches = [...root.querySelectorAll('button')].filter(button => button.textContent?.trim() === exactLabel);
    if (matches.length !== 1) return null;
    const path = [];
    for (let node = matches[0]; node && node !== root; node = node.parentElement) {
      const siblings = [...node.parentElement.children];
      const index = siblings.indexOf(node) + 1;
      if (index < 1) return null;
      path.unshift(`> ${node.tagName.toLowerCase()}:nth-child(${index})`);
    }
    return path.length > 0 ? `${rootSelector} ${path.join(' ')}` : null;
  }, [GENERATOR, label]);
  assert.ok(typeof selector === 'string' && selector.length > 0, 'generator_button_not_unique');
  return selector;
}

async function fixtureState({ base, sessionId, wdPost }, expectedGeneratedValue = null) {
  return wdPost(base, `/session/${sessionId}/execute/sync`, { script: `
    const current = document.querySelector('#current');
    const next = document.querySelector('#new');
    const confirm = document.querySelector('#confirm');
    return {
      currentUnchanged: current?.value === 'current-password-canary',
      newAndConfirmFilled: typeof next?.value === 'string' && next.value.length > 0
        && typeof confirm?.value === 'string' && confirm.value.length > 0,
      newAndConfirmMatch: next?.value === confirm?.value,
      newAndConfirmEqualExpected: arguments[0] === null
        ? null
        : next?.value === arguments[0] && confirm?.value === arguments[0],
      focusOnNewPassword: document.activeElement === next,
    };` , args: [expectedGeneratedValue] });
}

async function clearFixtureFields({ base, sessionId, wdPost }) {
  const ids = ['new', 'confirm'];
  for (const selector of ids.map(id => `#${id}`)) {
    const entry = await wdPost(base, `/session/${sessionId}/element`, { using: 'css selector', value: selector });
    const id = entry?.[ELEMENT_KEY];
    assert.ok(typeof id === 'string' && id.length > 0, 'generator_fixture_field_missing');
    await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(id)}/clear`, {});
  }
}

async function focusNewPassword({ base, sessionId, wdPost }) {
  const entry = await wdPost(base, `/session/${sessionId}/element`, { using: 'css selector', value: '#new' });
  const id = entry?.[ELEMENT_KEY];
  assert.ok(typeof id === 'string' && id.length > 0, 'generator_fixture_new_password_missing');
  await wdPost(base, `/session/${sessionId}/element/${encodeURIComponent(id)}/click`, {});
}

async function waitForGenerated(adapter) {
  await adapter.waitFor((document, rootSelector) => {
    const root = document.querySelector(rootSelector);
    return !!root?.querySelector('code')
      && !!root.querySelector('[aria-label="Reveal generated value"]')
      && !!root.querySelector('input[type="radio"][name="generated-password-target"]:checked')
      && root.querySelector('[aria-live="polite"]')?.textContent?.trim().startsWith('Generated.');
  }, [GENERATOR]);
}

async function visibleGeneratedValue(adapter) {
  // The value is used solely to compare a regeneration in process. It is never
  // returned, logged, or used as an assertion value.
  return adapter.evaluate((document, rootSelector) => {
    const root = document.querySelector(rootSelector);
    return root?.querySelector('code')?.textContent ?? null;
  }, [GENERATOR]);
}

async function runKind({ adapter, fixture, driver, kind }) {
  await driver.getContext('content');
  await clearFixtureFields(driver);
  await focusNewPassword(driver);
  await driver.getContext('chrome');
  const kindButton = await sidebarButton(adapter, kind);
  await adapter.trustedClick(kindButton);
  const generateButton = await sidebarButton(adapter, 'Generate');
  await adapter.trustedClick(generateButton, {
    outcome: (document, rootSelector) => !!document.querySelector(rootSelector)?.querySelector('[aria-label="Reveal generated value"]'),
    outcomeArgs: [GENERATOR],
  });
  await waitForGenerated(adapter);
  const masked = await adapter.evaluate((document, rootSelector) => {
    const code = document.querySelector(rootSelector)?.querySelector('code')?.textContent;
    return typeof code === 'string' && /^•+$/.test(code);
  }, [GENERATOR]);
  assert.equal(masked, true, 'generator_value_not_masked');

  await adapter.trustedClick(`${GENERATOR} [aria-label="Reveal generated value"]`, {
    outcome: (document, rootSelector) => !!document.querySelector(rootSelector)?.querySelector('[aria-label="Hide generated value"]'),
    outcomeArgs: [GENERATOR],
  });
  const first = await visibleGeneratedValue(adapter);
  assert.equal(typeof first === 'string' && first.length > 0, true, 'generator_reveal_missing_value');
  const firstMatchesDefaultShape = kind === 'Password'
    ? first.length === 24
    : first.split('-').length === 6 && first.split('-').every(word => word.length > 0);
  assert.equal(firstMatchesDefaultShape, true, 'generator_default_shape_invalid');

  await adapter.trustedClick(`${GENERATOR} [aria-label="Hide generated value"]`, {
    outcome: (document, rootSelector) => !!document.querySelector(rootSelector)?.querySelector('[aria-label="Reveal generated value"]'),
    outcomeArgs: [GENERATOR],
  });
  const regenerateButton = await sidebarButton(adapter, 'Regenerate');
  await adapter.trustedClick(regenerateButton, {
    outcome: (document, rootSelector) => !!document.querySelector(rootSelector)?.querySelector('[aria-label="Reveal generated value"]'),
    outcomeArgs: [GENERATOR],
  });
  await waitForGenerated(adapter);
  await adapter.trustedClick(`${GENERATOR} [aria-label="Reveal generated value"]`, {
    outcome: (document, rootSelector) => !!document.querySelector(rootSelector)?.querySelector('[aria-label="Hide generated value"]'),
    outcomeArgs: [GENERATOR],
  });
  const regenerated = await visibleGeneratedValue(adapter);
  const regenerationDiffers = typeof regenerated === 'string' && regenerated.length > 0 && regenerated !== first;
  assert.equal(regenerationDiffers, true, 'generator_regenerate_reused_value');
  const regeneratedMatchesDefaultShape = kind === 'Password'
    ? regenerated.length === 24
    : regenerated.split('-').length === 6 && regenerated.split('-').every(word => word.length > 0);
  assert.equal(regeneratedMatchesDefaultShape, true, 'generator_regenerated_default_shape_invalid');

  await adapter.trustedClick(`${GENERATOR} [aria-label="Hide generated value"]`, {
    outcome: (document, rootSelector) => !!document.querySelector(rootSelector)?.querySelector('[aria-label="Reveal generated value"]'),
    outcomeArgs: [GENERATOR],
  });
  await driver.getContext('content');
  await focusNewPassword(driver);
  const focused = await fixtureState(driver);
  assert.equal(focused.focusOnNewPassword, true, 'generator_fixture_new_password_not_focused');
  await driver.getContext('chrome');
  const useButton = await sidebarButton(adapter, 'Use');
  await adapter.trustedClick(useButton, {
    outcome: (document, rootSelector) => {
      const root = document.querySelector(rootSelector);
      return !root?.querySelector('code') && root?.querySelector('[aria-live="polite"]')?.textContent?.includes('Filled');
    },
    outcomeArgs: [GENERATOR],
  });
  await driver.getContext('content');
  const filled = await fixtureState(driver, regenerated);
  assert.equal(filled.currentUnchanged, true, 'generator_current_password_changed');
  assert.equal(filled.newAndConfirmFilled, true, 'generator_new_password_fields_empty');
  assert.equal(filled.newAndConfirmMatch, true, 'generator_new_password_fields_mismatch');
  assert.equal(filled.newAndConfirmEqualExpected, true, 'generator_new_password_fields_not_regenerated_value');
  assert.equal(fixture.state.submissions, 0, 'generator_submitted_fixture');
  await clearFixtureFields(driver);
  return { masked: true, revealed: true, hidden: true, regenerationDiffers: true, used: true };
}

export async function runFirefoxGeneratorChecks(dependencies) {
  assertHelperDependencies(dependencies);
  const { adapter, base, sessionId, wdPost, wdGet, wdDelete, getContext, proof } = dependencies;
  assert.ok(proof && typeof proof === 'object' && !Array.isArray(proof), 'generator_proof_missing');
  // `wdGet` is accepted with the session helpers so drivers can pass their
  // complete WebDriver contract unchanged; this helper needs only mutation-free
  // fixture navigation/inspection calls from its supplied transport.
  void wdGet;
  const driver = { base, sessionId, wdPost, getContext };
  const fixture = await createFixtureServer();
  let tabHandle = null;
  let originalHandle = null;
  let runError = null;
  let workPassed = false;
  proof.generator = {
    ok: false,
    password: null,
    passphrase: null,
    fixtureRequests: 0,
    fixtureSubmissions: 0,
    tabClosed: false,
    originalWindowRestored: false,
    fixtureServerClosed: false,
  };
  try {
    await getContext('content');
    originalHandle = await wdGet(base, `/session/${sessionId}/window`);
    assert.ok(typeof originalHandle === 'string' && originalHandle.length > 0, 'generator_original_window_missing');
    tabHandle = (await wdPost(base, `/session/${sessionId}/window/new`, { type: 'tab' }))?.handle;
    assert.ok(typeof tabHandle === 'string' && tabHandle.length > 0, 'generator_fixture_tab_missing');
    await wdPost(base, `/session/${sessionId}/window`, { handle: tabHandle });
    await wdPost(base, `/session/${sessionId}/url`, { url: fixture.url });
    await focusNewPassword(driver);

    await getContext('chrome');
    await adapter.waitFor(document => !!document.querySelector('[aria-label="Password generator"]'));
    const opener = await sidebarButton(adapter, 'Password generator');
    const open = await adapter.evaluate((document, selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'true', [opener]);
    if (!open) {
      await adapter.trustedClick(opener, {
        outcome: (document, selector) => document.querySelector(selector)?.getAttribute('aria-expanded') === 'true',
        outcomeArgs: [opener],
      });
    }

    const password = await runKind({ adapter, fixture, driver, kind: 'Password' });
    proof.generator.password = password;
    const passphrase = await runKind({ adapter, fixture, driver, kind: 'Passphrase' });
    proof.generator.passphrase = passphrase;
    assert.equal(fixture.state.submissions, 0, 'generator_fixture_submitted');
    workPassed = true;
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    let cleanupError = null;
    if (tabHandle) {
      try {
        await getContext('content');
        await wdPost(base, `/session/${sessionId}/window`, { handle: tabHandle });
        await wdDelete(base, `/session/${sessionId}/window`);
        const handles = await wdGet(base, `/session/${sessionId}/window/handles`);
        assert.equal(handles.includes(tabHandle), false, 'generator_fixture_tab_still_open');
        proof.generator.tabClosed = true;
      } catch (error) {
        if (!/no_such_window/i.test(String(error?.message))) cleanupError ||= error;
      }
    }
    if (originalHandle) {
      try {
        await getContext('content');
        const handles = await wdGet(base, `/session/${sessionId}/window/handles`);
        assert.equal(handles.includes(originalHandle), true, 'generator_original_window_missing_after_cleanup');
        await wdPost(base, `/session/${sessionId}/window`, { handle: originalHandle });
        assert.equal(await wdGet(base, `/session/${sessionId}/window`), originalHandle, 'generator_original_window_not_restored');
        proof.generator.originalWindowRestored = true;
      } catch (error) {
        cleanupError ||= error;
      }
    }
    try {
      await fixture.close();
    } catch (error) {
      cleanupError ||= error;
    }
    proof.generator.fixtureRequests = fixture.state.requests;
    proof.generator.fixtureSubmissions = fixture.state.submissions;
    proof.generator.fixtureServerClosed = fixture.state.closed;
    if (cleanupError && !runError) throw cleanupError;
    if (!runError && !cleanupError && workPassed
      && proof.generator.tabClosed && proof.generator.originalWindowRestored && proof.generator.fixtureServerClosed)
      proof.generator.ok = true;
  }
  return proof.generator;
}
