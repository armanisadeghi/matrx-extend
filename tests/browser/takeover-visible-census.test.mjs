import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { requireHostedAcceptanceCredential } from '../../scripts/hosted-profile-route.mjs';
import {
  CONTROL_SELECTOR,
  captureGuestReadiness,
  censusCompleteness,
  discoveryExpression,
  mapObservation,
  mutationGuard,
  observeGuestAuthentication,
  readBrowserVersion,
  settingsControlsExpression,
} from './takeover-visible-census.mjs';

test('known inventory labels map to source IDs while new visible controls stay explicit and private', () => {
  const privateFingerprint = 'a'.repeat(64);
  const result = mapObservation('settings_control', [
    { kind: 'button', label: 'Theme' },
    { kind: 'button', label_fingerprint: privateFingerprint },
    { kind: 'button', label_fingerprint: 'b'.repeat(64) },
  ]);
  assert.equal(result.total, 3);
  assert.deepEqual(result.mapped, [{ id: 'EXT-F-1003-C02', label: 'Theme', applicability: null }]);
  assert.equal(result.unmapped_count, 2);
  assert.deepEqual(result.unmapped[0], {
    kind: 'button',
    label_fingerprint: privateFingerprint,
  });
  assert.equal(JSON.stringify(result).includes('A private row title'), false);
  assert.throws(
    () => mapObservation('navigation', [{ kind: 'tab', label: 'A private title' }]),
    /census_unkeyed_unknown_refused/,
  );
});

test('browser version failures expose fixed safe diagnostics without transport content', async () => {
  for (const session of [
    {
      send: async () => {
        throw new Error('private browser payload');
      },
    },
    { send: async () => ({ product: 'private browser payload', protocolVersion: '1.3' }) },
  ]) {
    await assert.rejects(
      () => readBrowserVersion(session),
      (error) => {
        assert.equal(error.message, 'census_receipt_boundary_failed');
        assert.equal(error.receiptDiagnostic.target, 'owned_browser');
        assert.equal(error.receiptDiagnostic.version_observed, false);
        assert.doesNotMatch(JSON.stringify(error.receiptDiagnostic), /private/);
        return true;
      },
    );
  }
  assert.deepEqual(
    await readBrowserVersion({
      send: async () => ({
        product: 'Chrome/133.0.0.0',
        protocolVersion: '1.3',
        commandLine: 'private',
      }),
    }),
    { product: 'Chrome/133.0.0.0', protocol_version: '1.3' },
  );
});

test('backend mutation attempt is aborted without retaining URL or request body', async () => {
  let listener;
  const sent = [];
  const panel = {
    on(name, callback) {
      assert.equal(name, 'Fetch.requestPaused');
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    async send(method, params) {
      sent.push({ method, params });
    },
  };
  const guard = await mutationGuard(panel);
  listener({
    requestId: 'read',
    request: { url: 'https://db.matrxserver.com/rest/v1/private?token=secret', method: 'GET' },
  });
  listener({
    requestId: 'write',
    request: {
      url: 'https://db.matrxserver.com/rest/v1/private?token=secret',
      method: 'POST',
      postData: 'secret',
    },
  });
  assert.equal(guard.count(), 1);
  assert.deepEqual(guard.blocked(), { 'database:nonread_method': 1 });
  await guard.close();
  assert.deepEqual(
    sent.map((call) => call.method),
    ['Fetch.enable', 'Fetch.continueRequest', 'Fetch.failRequest', 'Fetch.disable'],
  );
  assert.equal(JSON.stringify(sent).includes('secret'), false);
  assert.equal(listener, undefined);
});

test('unknown labels, inaccessible regions, and intercepted RPCs each prevent completeness', () => {
  const empty = { total: 0, mapped: [], unmapped_count: 0, unmapped: [] };
  const observed = {
    navigation: empty,
    sections: empty,
    surfaces: {},
    controls: {},
    inaccessible_regions: [],
  };
  const emptyResult = censusCompleteness(observed, 0);
  assert.equal(emptyResult.complete, false);
  assert.ok(emptyResult.missing_required_regions.includes('navigation'));
  assert.ok(emptyResult.missing_required_regions.includes('settings_sections'));
  assert.equal(
    censusCompleteness({ ...observed, navigation: { ...empty, unmapped_count: 1 } }, 0)
      .unmapped_total,
    1,
  );
  assert.equal(
    censusCompleteness({ ...observed, inaccessible_regions: [{ region: 'tab_content' }] }, 0)
      .complete,
    false,
  );
  assert.equal(censusCompleteness(observed, 1).complete, false);
  const required = [
    'Account',
    'Organization',
    'Appearance',
    'Chat',
    'Privacy',
    'Scrape',
    'Data',
    'SEO',
    'Desktop bridge',
    'Data & reset',
    'About',
  ];
  const complete = {
    ...observed,
    navigation: { ...empty, total: 2, mapped: [{ label: 'Chat' }, { label: 'Settings' }] },
    surfaces: { Chat: empty },
    sections: { ...empty, total: required.length, mapped: required.map((label) => ({ label })) },
    controls: Object.fromEntries(required.map((label) => [label, empty])),
  };
  assert.equal(censusCompleteness(complete, 0).complete, true);
  assert.equal(
    censusCompleteness(
      { ...complete, navigation: { ...complete.navigation, unsupported_trigger_count: 1 } },
      0,
    ).complete,
    false,
  );
  assert.equal(
    censusCompleteness({ ...complete, authentication: { role: 'guest' } }, 0).complete,
    false,
  );
  assert.equal(
    censusCompleteness(
      {
        ...complete,
        authentication: { role: 'guest', signed_out_observed: true },
        authentication_after: { signed_out_observed: true },
      },
      0,
    ).complete,
    true,
  );
  assert.equal(
    censusCompleteness(
      { ...complete, authentication: { role: 'guest', signed_out_observed: true } },
      0,
    ).complete,
    false,
  );
  assert.equal(censusCompleteness({ ...complete, surfaces: {} }, 0).complete, false);
  assert.equal(censusCompleteness({ ...complete, sections: empty }, 0).complete, false);
  assert.equal(censusCompleteness({ ...complete, controls: {} }, 0).complete, false);
  assert.ok(
    censusCompleteness(
      {
        ...complete,
        sections: {
          ...complete.sections,
          total: required.length - 1,
          mapped: complete.sections.mapped.filter((item) => item.label !== 'Organization'),
        },
      },
      0,
    ).missing_required_regions.includes('settings_section:Organization'),
  );
});

test('Settings census observes the actual OpenUrl anchor as C39 without emitting its href', async () => {
  const window = new Window({
    url: 'chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html',
  });
  window.document.body.innerHTML =
    '<button aria-expanded="true" aria-controls="organization">Organization</button><div id="organization"><a href="https://www.aimatrx.com/organizations" title="https://www.aimatrx.com/organizations"><span>Open Organizations to restore an archived organization</span></a></div>';
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20 });
  const expression = settingsControlsExpression('Organization', randomBytes(32).toString('base64'));
  const observed = await vm.runInNewContext(expression, {
    document: window.document,
    getComputedStyle: window.getComputedStyle.bind(window),
    crypto: webcrypto,
    TextEncoder,
    atob,
  });
  const mapped = mapObservation('settings_control', observed);
  assert.equal(mapped.total, 1);
  assert.deepEqual(
    mapped.mapped.map((item) => item.id),
    ['EXT-F-1003-C39'],
  );
  assert.equal(JSON.stringify(mapped).includes('https://'), false);
});

test('unknown DOM labels use a fresh keyed fingerprint without raw text or correlation', async () => {
  const window = new Window({
    url: 'chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html',
  });
  window.document.body.innerHTML =
    '<button aria-expanded="true" aria-controls="account">Account</button><div id="account"><button>Private account row</button></div>';
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20 });
  const observe = (key) =>
    vm.runInNewContext(settingsControlsExpression('Account', key), {
      document: window.document,
      getComputedStyle: window.getComputedStyle.bind(window),
      crypto: webcrypto,
      TextEncoder,
      atob,
    });
  const first = await observe(randomBytes(32).toString('base64'));
  const second = await observe(randomBytes(32).toString('base64'));
  assert.equal(first.length, 1);
  assert.match(first[0].label_fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(first[0].label_fingerprint, second[0].label_fingerprint);
  assert.equal(JSON.stringify(first).includes('Private account row'), false);
});

test('Settings census links only exact source-rendered row labels to observed controls', async () => {
  const context =
    domContext(`<button aria-expanded="true" aria-controls="appearance">Appearance</button>
    <div id="appearance">
      <div><div><span>Theme</span><span>Private neighboring hint</span></div><div><button role="combobox" data-census-id="EXT-F-9999-C99"><span>Private selected value</span></button></div></div>
      <div><div><span>Theme</span></div><div><button role="combobox">Private duplicate</button></div></div>
      <div><div><span>Private row</span></div><div><button role="combobox">Private option</button></div></div>
    </div>`);
  const observed = await vm.runInNewContext(
    settingsControlsExpression('Appearance', randomBytes(32).toString('base64')),
    context,
  );
  assert.equal(observed.length, 3);
  assert.ok(
    observed.every((item) => item.provenance.row_label === undefined),
    'duplicate static labels are ambiguous',
  );
  assert.doesNotMatch(JSON.stringify(observed), /Private|EXT-F-9999/);
  context.document.querySelectorAll('#appearance > div')[1].remove();
  const unambiguous = await vm.runInNewContext(
    settingsControlsExpression('Appearance', randomBytes(32).toString('base64')),
    context,
  );
  assert.equal(unambiguous[0].provenance.row_label, 'Theme');
  assert.equal(unambiguous[1].provenance.row_label, undefined);
  assert.doesNotMatch(JSON.stringify(unambiguous), /Private/);
});

test('Desktop bridge census links each input and button only to its exact static row', async () => {
  const context =
    domContext(`<button aria-expanded="true" aria-controls="desktop">Desktop bridge</button>
    <div id="desktop">
      <div><input placeholder="Pair code" value="Private pair token"><button>Pair</button></div>
      <div><span>Local engine port</span><input placeholder="auto" value="Private port"><button>Save</button><span>override</span></div>
      <div><span>Private neighboring text</span><input placeholder="auto"><button>Save</button></div>
    </div>`);
  const observed = await vm.runInNewContext(
    settingsControlsExpression('Desktop bridge', randomBytes(32).toString('base64')),
    context,
  );
  assert.deepEqual(
    Array.from(observed, (item) => item.provenance.row_label ?? null),
    ['Pair code', 'Pair code', 'Local engine port', 'Local engine port', null, null],
  );
  assert.doesNotMatch(JSON.stringify(observed), /Private|value=|override/);
});

test('direct census invocation refuses before browser or credentials without resource guard', () => {
  const result = spawnSync(process.execPath, ['tests/browser/takeover-visible-census.mjs'], {
    env: { PATH: process.env.PATH, MATRX_CENSUS_ROLE: 'guest' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /census_artifact_inputs_required/);
  assert.doesNotMatch(result.stderr, /secret|password|token/i);
});

test('hosted census role preflight requires real auth only for member and admin', () => {
  assert.doesNotThrow(() => requireHostedAcceptanceCredential('visibility-census-guest', {}));
  assert.throws(
    () => requireHostedAcceptanceCredential('visibility-census-member', {}),
    /hosted_member_link_secret_required/,
  );
  assert.throws(
    () => requireHostedAcceptanceCredential('visibility-census-admin', {}),
    /hosted_admin_secret_required/,
  );
  assert.doesNotThrow(() =>
    requireHostedAcceptanceCredential('visibility-census-admin', {
      MATRX_HOSTED_ADMIN_CREDENTIALS_JSON: '{"email":"admin@admin.com","password":"opaque"}',
    }),
  );
});

// The owner inventories the extension before testing behavior. Alternate markup must
// remain visible in the inventory without granting permission to activate it.
function domContext(html, stored = {}) {
  const window = new Window({
    url: 'chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html',
  });
  window.document.body.innerHTML = html;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20 });
  return {
    document: window.document,
    getComputedStyle: window.getComputedStyle.bind(window),
    crypto: webcrypto,
    TextEncoder,
    atob,
    chrome: { storage: { local: { get: async () => stored } } },
  };
}

test('discovery retains untitled and alternate tab shapes but only permits mapped native triggers', async () => {
  const context = domContext(`<div role="tablist">
    <button role="tab" title="Settings" aria-controls="settings">Settings</button>
    <button role="tab">Private workspace tab</button>
    <a role="tab" href="/private" aria-label="Chat">Chat</a>
    <div tabindex="0">Private unclassified navigation</div>
    </div>`);
  const observed = await vm.runInNewContext(
    discoveryExpression('navigation', randomBytes(32).toString('base64')),
    context,
  );
  assert.equal(observed.length, 4, 'alternate navigation must not disappear');
  assert.equal(observed.filter((item) => item.safe_to_open).length, 1);
  assert.equal(observed.find((item) => item.label === 'Chat').safe_to_open, false);
  assert.equal(mapObservation('navigation', observed).unmapped_count, 2);
  assert.doesNotMatch(JSON.stringify(observed), /Private|href|workspace/);
});

test('census distinguishes structural containers and actions from unopened regions with safe provenance', async () => {
  const context =
    domContext(`<header><div role="tablist" tabindex="0"><button role="tab" title="Settings" aria-controls="settings" data-state="active">Settings</button></div><button role="Private account email" aria-label="Private account email">Private account email</button></header>
    <div role="tabpanel" id="settings" data-state="active"><button aria-expanded="true" aria-controls="account">Account</button><button>Private action</button></div>`);
  const key = randomBytes(32).toString('base64');
  const navigation = await vm.runInNewContext(discoveryExpression('navigation', key), context);
  const sections = await vm.runInNewContext(discoveryExpression('section', key), context);
  assert.equal(
    navigation.map((item) => item.classification).join(','),
    'structural,navigation,action',
  );
  assert.equal(sections.map((item) => item.classification).join(','), 'section,action');
  assert.equal(navigation[0].safe_to_open, false);
  assert.equal(
    navigation[1].safe_to_open,
    true,
    'a structural parent must not make its real Settings tab ambiguous',
  );
  assert.equal(navigation[2].safe_to_open, false);
  assert.equal(sections[1].safe_to_open, false);
  assert.equal(navigation[2].provenance.tag, 'button');
  assert.equal(navigation[2].provenance.region, 'header');
  assert.equal(typeof navigation[2].provenance.dom_order, 'number');
  assert.equal(navigation[2].provenance.role, null);
  assert.doesNotMatch(
    JSON.stringify({ navigation, sections }),
    /Private account email|Private action/,
  );
  assert.equal(JSON.stringify({ navigation, sections }).includes(key), false);
  assert.equal(mapObservation('navigation', navigation).structural_count, 1);
  assert.equal(mapObservation('navigation', navigation).action_count, 1);
});

test('discovery retains summary, non-button expanders and unclassified section controls', async () => {
  const context =
    domContext(`<button role="tab" title="Settings" aria-controls="settings" data-state="active">Settings</button>
    <div role="tabpanel" id="settings" data-state="active">
    <button aria-expanded="false" aria-controls="account">Account</button>
    <div role="button" aria-expanded="false">Appearance</div>
    <details><summary>Private section</summary></details>
    <button>Private unclassified section</button></div>`);
  const observed = await vm.runInNewContext(
    discoveryExpression('section', randomBytes(32).toString('base64')),
    context,
  );
  assert.equal(observed.length, 4, 'alternate section triggers must not disappear');
  assert.equal(observed.filter((item) => item.safe_to_open).length, 1);
  assert.equal(observed.find((item) => item.label === 'Appearance').safe_to_open, false);
  assert.equal(mapObservation('section', observed).unmapped_count, 2);
  assert.doesNotMatch(JSON.stringify(observed), /Private/);
});

test('Settings section readiness uses its active panel while retaining unknown section triggers', async () => {
  const context = domContext(`<button title="Account">G</button>
    <button role="tab" title="Settings" aria-controls="settings" data-state="active">Settings</button>
    <div role="tabpanel" id="settings" data-state="active" tabindex="0">
      <button aria-expanded="true" aria-controls="account">Account</button>
      <div id="account"><button>Sign in</button></div>
      <button>Private unclassified section</button>
    </div>`);
  const observed = await vm.runInNewContext(
    discoveryExpression('section', randomBytes(32).toString('base64')),
    context,
  );
  assert.equal(observed.length, 2);
  assert.equal(observed.find((item) => item.label === 'Account')?.safe_to_open, true);
  assert.equal(mapObservation('section', observed).unmapped_count, 1);
  assert.doesNotMatch(JSON.stringify(observed), /Private/);
});

test('Settings readiness refuses an inactive panel or duplicate Account expanders inside it', async () => {
  const key = randomBytes(32).toString('base64');
  const inactive =
    domContext(`<button role="tab" title="Settings" aria-controls="settings" data-state="inactive">Settings</button>
    <div role="tabpanel" id="settings" data-state="inactive"><button aria-expanded="true" aria-controls="account">Account</button></div>`);
  assert.equal((await vm.runInNewContext(discoveryExpression('section', key), inactive)).length, 0);
  const duplicated =
    domContext(`<button role="tab" title="Settings" aria-controls="settings" data-state="active">Settings</button>
    <div role="tabpanel" id="settings" data-state="active">
      <button aria-expanded="true" aria-controls="account-one">Account</button>
      <button aria-expanded="true" aria-controls="account-two">Account</button>
    </div>`);
  const observed = await vm.runInNewContext(discoveryExpression('section', key), duplicated);
  assert.equal(observed.filter((item) => item.label === 'Account').length, 2);
  assert.equal(
    observed.some((item) => item.safe_to_open),
    false,
  );
});

const guestHtml = `<button role="tab" title="Settings" aria-controls="settings" data-state="active">Settings</button>
  <div role="tabpanel" id="settings" data-state="active">
    <button aria-expanded="true" aria-controls="account">Account</button>
    <div id="account"><span>Email</span><span>—</span></div>
    <button>Sign in</button>
  </div>`;
function guestPanel(context) {
  return {
    send: async (method, params) => {
      assert.equal(method, 'Runtime.evaluate');
      return { result: { value: await vm.runInNewContext(params.expression, context) } };
    },
  };
}

test('guest evidence requires observed signed-out account and absent credentials', async () => {
  const evidence = await observeGuestAuthentication(guestPanel(domContext(guestHtml)));
  assert.equal(evidence.signed_out_observed, true, 'guest cannot be a requested role label alone');
  assert.equal(evidence.access_token_present, false);
  assert.equal(evidence.refresh_token_present, false);
  assert.equal(evidence.profile_present, false);
  assert.equal(evidence.sign_in_visible, true);
});

test('guest observation refuses every contradictory or missing auth signal without leaking identity', async () => {
  for (const [html, stored] of [
    [guestHtml, { 'matrx.auth.accessToken': 'private-token' }],
    [guestHtml, { 'matrx.auth.refreshTokenEnc': 'private-refresh' }],
    [guestHtml, { 'matrx.auth.refreshTokenIv': 'private-iv' }],
    [guestHtml, { 'matrx.user.profile': { id: 'private-profile' } }],
    [guestHtml, { 'matrx.user.isAdmin': true }],
    [guestHtml.replace('Sign in', 'Sign out'), {}],
    [guestHtml.replace('<button>Sign in</button>', ''), {}],
    [guestHtml.replace('aria-expanded="true"', 'aria-expanded="false"'), {}],
    ['', {}],
  ]) {
    await assert.rejects(
      () => observeGuestAuthentication(guestPanel(domContext(html, stored))),
      (error) => error.message === 'census_guest_signed_out_unverified',
    );
  }
});

test('discovery contract detects an in-memory narrowed selector and constant-result replacement', async () => {
  const html =
    '<div role="tablist"><button role="tab" title="Settings" aria-controls="settings">Settings</button><a role="tab">Private navigation</a></div>';
  const expression = discoveryExpression('navigation', randomBytes(32).toString('base64'));
  const verify = async (observe) => {
    const rows = await observe(html);
    assert.equal(rows.length, 2, 'alternate trigger omitted');
    assert.equal(rows.filter((row) => row.safe_to_open).length, 1);
    assert.equal((await observe('')).length, 0, 'constant result invents absent triggers');
  };
  const observe = (markup) => vm.runInNewContext(expression, domContext(markup));
  await verify(observe);
  const narrowed = expression.replace(
    JSON.stringify(CONTROL_SELECTOR),
    JSON.stringify('button[role="tab"][title]'),
  );
  await assert.rejects(
    () => verify((markup) => vm.runInNewContext(narrowed, domContext(markup))),
    /alternate trigger omitted/,
  );
  const constant = await observe(html);
  await assert.rejects(
    () => verify(async () => constant),
    /constant result invents absent triggers/,
  );
});

test('guest contract detects a constant signed-out replacement', async () => {
  const verify = async (observe) => {
    const signedOut = await observe(guestPanel(domContext(guestHtml)));
    assert.equal(signedOut.signed_out_observed, true);
    await assert.rejects(
      () =>
        observe(guestPanel(domContext(guestHtml, { 'matrx.auth.accessToken': 'private-token' }))),
      /census_guest_signed_out_unverified/,
    );
  };
  await verify(observeGuestAuthentication);
  const constant = await observeGuestAuthentication(guestPanel(domContext(guestHtml)));
  await assert.rejects(() => verify(async () => constant), /Missing expected rejection/);
});

test('guest capture frames Account after signed-out proof and restricts an existing screenshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'census-receipt-'));
  try {
    const output = join(directory, 'guest.json');
    const screenshot = `${output}.guest-account-readiness.png`;
    await writeFile(screenshot, 'old private pixels', { mode: 0o644 });
    await (await import('node:fs/promises')).chmod(screenshot, 0o644);
    const context = domContext(guestHtml);
    let scrolled = false;
    context.innerHeight = 400;
    context.innerWidth = 400;
    const header = context.document.querySelector('button[aria-expanded]');
    header.scrollIntoView = () => {
      scrolled = true;
    };
    context.document.defaultView.HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 100,
      height: 20,
      top: scrolled ? 20 : 800,
      bottom: scrolled ? 40 : 820,
      left: 10,
      right: 110,
    });
    const calls = [];
    const panel = {
      async send(method, params) {
        calls.push(method);
        if (method === 'Runtime.evaluate')
          return { result: { value: vm.runInNewContext(params.expression, context) } };
        assert.equal(method, 'Page.captureScreenshot');
        assert.equal(scrolled, true);
        return { data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') };
      },
    };
    await assert.rejects(
      () => captureGuestReadiness(panel, output, { signed_out_observed: false }),
      /census_guest_signed_out_unverified/,
    );
    assert.equal(calls.length, 0);
    assert.equal(
      await captureGuestReadiness(panel, output, { signed_out_observed: true }),
      screenshot,
    );
    assert.deepEqual(calls, ['Runtime.evaluate', 'Page.captureScreenshot']);
    assert.equal((await stat(screenshot)).mode & 0o777, 0o600);
    assert.equal((await readFile(screenshot)).toString('hex'), '89504e470d0a1a0a');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('guest screenshot failures retain stage and last safe observations without payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'census-receipt-'));
  try {
    const context = domContext(guestHtml);
    context.innerHeight = 400;
    context.innerWidth = 400;
    context.document.querySelector('button[aria-expanded]').scrollIntoView = () => {};
    context.document.defaultView.HTMLElement.prototype.getBoundingClientRect = () => ({
      width: 100,
      height: 20,
      top: 20,
      bottom: 40,
      left: 10,
      right: 110,
    });
    const panel = (screenshot) => ({
      send: async (method, params) =>
        method === 'Runtime.evaluate'
          ? { result: { value: vm.runInNewContext(params.expression, context) } }
          : screenshot(),
    });
    for (const [output, screenshot, stage] of [
      [
        join(directory, 'send'),
        () => {
          throw new Error('private transport');
        },
        'guest_screenshot_send',
      ],
      [join(directory, 'decode'), () => ({ data: 'private payload' }), 'guest_screenshot_decode'],
      [
        join(directory, 'missing', 'write'),
        () => ({ data: Buffer.from('89504e470d0a1a0a', 'hex').toString('base64') }),
        'guest_screenshot_write',
      ],
    ]) {
      await assert.rejects(
        () => captureGuestReadiness(panel(screenshot), output, { signed_out_observed: true }),
        (error) => {
          assert.equal(error.message, 'census_receipt_boundary_failed');
          assert.equal(error.receiptDiagnostic.stage, stage);
          assert.equal(error.receiptDiagnostic.target, 'sidepanel_account');
          assert.equal(error.receiptDiagnostic.signed_out_observed, true);
          assert.equal(error.receiptDiagnostic.account_header_in_viewport, true);
          assert.doesNotMatch(JSON.stringify(error.receiptDiagnostic), /private|missing/);
          return true;
        },
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('guest screenshot refuses capture when Account remains outside the viewport', async () => {
  const context = domContext(guestHtml);
  context.innerHeight = 400;
  context.innerWidth = 400;
  let scrollAttempted = false;
  context.document.querySelector('button[aria-expanded]').scrollIntoView = () => {
    scrollAttempted = true;
  };
  context.document.defaultView.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 100,
    height: 20,
    top: 800,
    bottom: 820,
    left: 10,
    right: 110,
  });
  const panel = {
    send: async (method, params) => {
      assert.equal(method, 'Runtime.evaluate', 'capture must not start without viewport proof');
      return { result: { value: vm.runInNewContext(params.expression, context) } };
    },
  };
  await assert.rejects(
    () => captureGuestReadiness(panel, '/unused', { signed_out_observed: true }),
    (error) => {
      assert.equal(error.receiptDiagnostic.stage, 'guest_account_viewport');
      assert.equal(error.receiptDiagnostic.account_header_in_viewport, false);
      return true;
    },
  );
  assert.equal(scrollAttempted, true);
});

test('guest screenshot refuses a one-pixel Account header or Sign in sliver', async () => {
  for (const sliver of ['header', 'sign_in']) {
    const context = domContext(guestHtml);
    context.innerHeight = 400;
    context.innerWidth = 400;
    const header = context.document.querySelector('button[aria-expanded]');
    const signIn = [...context.document.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === 'Sign in',
    );
    header.scrollIntoView = () => {};
    context.document.defaultView.HTMLElement.prototype.getBoundingClientRect = function () {
      const clipped = this === (sliver === 'header' ? header : signIn);
      return {
        width: 100,
        height: 20,
        top: clipped ? -19 : 20,
        bottom: clipped ? 1 : 40,
        left: 10,
        right: 110,
      };
    };
    const panel = {
      send: async (method, params) => {
        assert.equal(method, 'Runtime.evaluate', 'capture must refuse a sliver');
        return { result: { value: vm.runInNewContext(params.expression, context) } };
      },
    };
    await assert.rejects(
      () => captureGuestReadiness(panel, '/unused', { signed_out_observed: true }),
      (error) => {
        assert.equal(error.receiptDiagnostic.stage, 'guest_account_viewport');
        assert.equal(error.receiptDiagnostic.account_content_in_viewport, true);
        assert.equal(error.receiptDiagnostic.account_header_in_viewport, sliver !== 'header');
        assert.equal(error.receiptDiagnostic.sign_in_in_viewport, sliver !== 'sign_in');
        return true;
      },
    );
  }
});
