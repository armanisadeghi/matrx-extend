import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { requireHostedAcceptanceCredential } from '../../scripts/hosted-profile-route.mjs';
import { censusCompleteness, mapObservation, mutationGuard } from './takeover-visible-census.mjs';

const hash = (label) => createHash('sha256').update(label).digest('hex');

test('known inventory labels map to source IDs while new visible controls stay explicit and private', () => {
  const result = mapObservation('settings_control', [
    { kind: 'button', label: 'Theme' },
    { kind: 'button', label: 'A private row title' },
    { kind: 'button', label: '' },
  ]);
  assert.equal(result.total, 3);
  assert.deepEqual(result.mapped, [{ id: 'EXT-F-1003-C02', label: 'Theme', applicability: null }]);
  assert.equal(result.unmapped_count, 2);
  assert.deepEqual(result.unmapped[0], {
    kind: 'button',
    label_sha256: hash('A private row title'),
    label_length: 19,
  });
  assert.equal(JSON.stringify(result).includes('A private row title'), false);
  assert.equal(mapObservation('navigation', [{ kind: 'tab', label: 'New tab' }]).unmapped_count, 1);
  assert.equal(
    mapObservation('section', [{ kind: 'button', label: 'New group' }]).unmapped_count,
    1,
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
  assert.equal(censusCompleteness(observed, 0).complete, true);
  assert.deepEqual(
    censusCompleteness({ ...observed, navigation: { ...empty, unmapped_count: 1 } }, 0),
    { complete: false, unmapped_total: 1, inaccessible_count: 0, blocked_request_count: 0 },
  );
  assert.equal(
    censusCompleteness({ ...observed, inaccessible_regions: [{ region: 'tab_content' }] }, 0)
      .complete,
    false,
  );
  assert.equal(censusCompleteness(observed, 1).complete, false);
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
