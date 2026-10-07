import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { requireHostedAcceptanceCredential } from '../../scripts/hosted-profile-route.mjs';
import {
  censusCompleteness,
  mapObservation,
  mutationGuard,
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
