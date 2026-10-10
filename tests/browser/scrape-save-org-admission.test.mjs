import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  observeMemberLogicalOrganizationGet,
  refreshMemberLogicalOrganizationGet,
} from './member-logical-org-proof.mjs';

const EXPECTED_ORG = 'a4152086-c3e5-44e8-a853-8e3da9918dd8';
const OTHER_ORG = '3e26f91c-6654-4ab8-b554-13e404918d3b';
const TOKEN = 'Bearer private-test-token';
const ORIGIN = 'https://server.app.matrxserver.com';

function observedPanel() {
  const listeners = new Map();
  return {
    on(event, callback) {
      const callbacks = listeners.get(event) ?? new Set();
      callbacks.add(callback);
      listeners.set(event, callbacks);
      return () => callbacks.delete(callback);
    },
    async send(command) {
      assert.ok(['Network.enable', 'Runtime.evaluate'].includes(command));
      if (command === 'Runtime.evaluate') return { result: { value: true } };
      return {};
    },
    emit(event, payload) {
      for (const callback of listeners.get(event) ?? []) callback(payload);
    },
    listenerCount() {
      return [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0);
    },
  };
}

function emitRequest(
  panel,
  {
    requestId = 'org-read',
    method = 'GET',
    url = `${ORIGIN}/api/compute-targets/`,
    headers = { Authorization: TOKEN, 'X-Organization-Id': EXPECTED_ORG },
  } = {},
) {
  panel.emit('Network.requestWillBeSent', {
    requestId,
    request: { method, url, headers },
  });
  panel.emit('Network.responseReceived', { requestId, response: { status: 200 } });
  panel.emit('Network.loadingFinished', { requestId });
}

test('D187 admission requires the authenticated compute-target GET to match the private fixture org', async () => {
  const panel = observedPanel();
  const proof = observeMemberLogicalOrganizationGet(panel, EXPECTED_ORG, ORIGIN);
  await proof.start();

  emitRequest(panel); // Stale/background GET before arming must not satisfy proof.
  assert.equal(proof.snapshot().exact_get_count, 0);
  emitRequest(panel, { method: 'POST' });
  emitRequest(panel, { url: 'https://unrelated.invalid/api/compute-targets/' });
  proof.arm();
  emitRequest(panel, { method: 'POST' });
  emitRequest(panel, { url: 'https://unrelated.invalid/api/compute-targets/' });
  await assert.rejects(() => proof.verify(20), /d87_member_logical_organization_get_not_observed/);
  proof.stop();
  assert.equal(panel.listenerCount(), 0);
});

test('D187 admission rejects missing and wrong organization headers and unauthenticated requests', async () => {
  const missingOrgPanel = observedPanel();
  const missingOrg = observeMemberLogicalOrganizationGet(missingOrgPanel, EXPECTED_ORG, ORIGIN);
  await missingOrg.start();
  missingOrg.arm();
  emitRequest(missingOrgPanel, { headers: { Authorization: TOKEN } });
  await assert.rejects(() => missingOrg.verify(20), /d87_member_logical_organization_mismatch/);
  missingOrg.stop();

  const wrongOrgPanel = observedPanel();
  const wrongOrg = observeMemberLogicalOrganizationGet(wrongOrgPanel, EXPECTED_ORG, ORIGIN);
  await wrongOrg.start();
  wrongOrg.arm();
  emitRequest(wrongOrgPanel, {
    headers: { Authorization: TOKEN, 'x-organization-id': OTHER_ORG },
  });
  await assert.rejects(() => wrongOrg.verify(20), /d87_member_logical_organization_mismatch/);
  wrongOrg.stop();

  const unauthenticatedPanel = observedPanel();
  const unauthenticated = observeMemberLogicalOrganizationGet(
    unauthenticatedPanel,
    EXPECTED_ORG,
    ORIGIN,
  );
  await unauthenticated.start();
  unauthenticated.arm();
  emitRequest(unauthenticatedPanel, {
    headers: { 'x-organization-id': EXPECTED_ORG },
  });
  await assert.rejects(
    () => unauthenticated.verify(20),
    /d87_member_logical_organization_unauthenticated/,
  );
  unauthenticated.stop();
});

test('the D187 acceptance flow proves logical org before its first Save Source action', async () => {
  const source = await readFile(
    new URL('./scrape-save-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const observer = source.indexOf('observeMemberLogicalOrganizationGet(');
  const verify = source.indexOf('.verify(', observer);
  const firstSave = source.indexOf("click(panel, 'button-text', 'Save Source')");

  assert.ok(observer >= 0, 'scrape_save_logical_organization_observer_missing');
  const start = source.indexOf('await observer.start()', observer);
  const refresh = source.indexOf('refreshMemberLogicalOrganizationGet(panel, observer)', start);
  assert.ok(verify > observer, 'scrape_save_logical_organization_verify_missing');
  assert.ok(firstSave > verify, 'scrape_save_write_before_logical_organization_verified');
  assert.ok(start > observer && start < refresh, 'scrape_save_observer_not_started_before_read');
  assert.ok(refresh > start && refresh < verify, 'scrape_save_fresh_read_not_forced_before_verify');
  assert.ok(
    source.slice(observer, refresh).includes('expectedOrganizationId'),
    'scrape_save_private_organization_fixture_not_compared',
  );
});

test('the observer receipt contains only bounded facts, never the private org UUID or bearer', async () => {
  const panel = observedPanel();
  const proof = observeMemberLogicalOrganizationGet(panel, EXPECTED_ORG, ORIGIN);
  await proof.start();
  const actions = [];
  await refreshMemberLogicalOrganizationGet(panel, proof, async (_panel, kind, label) => {
    actions.push([kind, label]);
    if (kind === 'chat-compute-refresh') emitRequest(panel);
  });
  const receipt = await proof.verify(20);
  proof.stop();

  assert.deepEqual(actions, [
    ['title', 'Chat'],
    ['chat-compute-trigger', 'Compute'],
    ['chat-compute-refresh', 'Refresh'],
  ]);

  assert.deepEqual(receipt, {
    request_observed: true,
    authenticated: true,
    organization_matches_expected: true,
    http_status: 200,
  });
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes(EXPECTED_ORG), false);
  assert.equal(serialized.includes(TOKEN), false);
  assert.equal(serialized.toLowerCase().includes('authorization'), false);
  assert.equal(serialized.toLowerCase().includes('x-organization-id'), false);
  assert.equal(serialized.includes('200'), true);
});
