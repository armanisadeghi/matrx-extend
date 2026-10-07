import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { requireHostedAcceptanceCredential } from '../../scripts/hosted-profile-route.mjs';
import {
  CONTROL_SELECTOR,
  censusCompleteness,
  discoveryExpression,
  mapObservation,
  mutationGuard,
  observeGuestAuthentication,
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
