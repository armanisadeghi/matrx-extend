import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeMemberLogicalOrganizationGet,
  refreshMemberLogicalOrganizationGet,
  requireProductionBackendOrigin,
} from './member-logical-org-proof.mjs';

const EXPECTED = 'a4152086-c3e5-44e8-a853-8e3da9918dd8';
const OTHER = '3e26f91c-6654-4ab8-b554-13e404918d3b';
const ORIGIN = 'https://server.app.matrxserver.com';

test('member request proof refuses a non-production backend or override', async () => {
  const panel = (value) => ({
    send: async (method) => {
      assert.equal(method, 'Runtime.evaluate');
      return { result: { value } };
    },
  });
  assert.equal(
    await requireProductionBackendOrigin(panel({ production: true, override_absent: true })),
    ORIGIN,
  );
  await assert.rejects(
    () => requireProductionBackendOrigin(panel({ production: false, override_absent: true })),
    /member_logical_org_backend_not_production/,
  );
  await assert.rejects(
    () => requireProductionBackendOrigin(panel({ production: true, override_absent: false })),
    /member_logical_org_backend_override_present/,
  );
});

test('fresh compute read arms only after the picker is ready and before Refresh', async () => {
  const actions = [];
  const panel = {
    send: async (command) => {
      assert.equal(command, 'Runtime.evaluate');
      return { result: { value: true } };
    },
  };
  await refreshMemberLogicalOrganizationGet(
    panel,
    { arm: () => actions.push('arm') },
    async (_panel, kind) => actions.push(kind),
  );
  assert.deepEqual(actions, ['title', 'chat-compute-trigger', 'arm', 'chat-compute-refresh']);
});

function networkPanel() {
  const listeners = new Map();
  let nextId = 0;
  return {
    on(event, listener) {
      const group = listeners.get(event) ?? new Set();
      group.add(listener);
      listeners.set(event, group);
      return () => group.delete(listener);
    },
    async send(method) {
      assert.equal(method, 'Network.enable');
    },
    emit({
      method = 'GET',
      url = `${ORIGIN}/api/compute-targets/`,
      organizationId = EXPECTED,
      authorization = 'Bearer private-token',
      status = 200,
    } = {}) {
      const requestId = String(++nextId);
      for (const listener of listeners.get('Network.requestWillBeSent') ?? [])
        listener({
          requestId,
          request: {
            method,
            url,
            headers: {
              Authorization: authorization,
              'x-organization-id': organizationId,
            },
          },
        });
      for (const listener of listeners.get('Network.responseReceived') ?? [])
        listener({ requestId, response: { status } });
      for (const listener of listeners.get('Network.loadingFinished') ?? [])
        listener({ requestId });
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, group) => sum + group.size, 0);
    },
  };
}

test('real authenticated read binds the expected logical organization ID; a same-label wrong ID fails', async () => {
  const matchingPanel = networkPanel();
  const matching = observeMemberLogicalOrganizationGet(matchingPanel, EXPECTED, ORIGIN);
  await matching.start();
  matchingPanel.emit();
  assert.equal(matching.snapshot().exact_get_count, 0, 'pre-arm request is stale');
  matching.arm();
  matchingPanel.emit({ method: 'POST' });
  matchingPanel.emit({ url: 'https://other.example/api/compute-targets/' });
  matchingPanel.emit({ url: `${ORIGIN}/api/compute-targets/resolve` });
  assert.equal(matching.snapshot().exact_get_count, 0);
  matchingPanel.emit();
  assert.deepEqual(await matching.verify(), {
    request_observed: true,
    authenticated: true,
    organization_matches_expected: true,
    http_status: 200,
  });
  matching.stop();
  assert.equal(matchingPanel.listenerCount(), 0);

  // The visible Settings label could still be identical for two memberships.
  const wrongPanel = networkPanel();
  const wrong = observeMemberLogicalOrganizationGet(wrongPanel, EXPECTED, ORIGIN);
  await wrong.start();
  wrong.arm();
  wrongPanel.emit({ organizationId: OTHER });
  await assert.rejects(() => wrong.verify(), /d87_member_logical_organization_mismatch/);
  wrong.stop();
  assert.equal(wrongPanel.listenerCount(), 0);

  const unauthenticatedPanel = networkPanel();
  const unauthenticated = observeMemberLogicalOrganizationGet(
    unauthenticatedPanel,
    EXPECTED,
    ORIGIN,
  );
  await unauthenticated.start();
  unauthenticated.arm();
  unauthenticatedPanel.emit({ authorization: '' });
  await assert.rejects(
    () => unauthenticated.verify(),
    /d87_member_logical_organization_unauthenticated/,
  );
  unauthenticated.stop();

  const missingHeaderPanel = networkPanel();
  const missingHeader = observeMemberLogicalOrganizationGet(missingHeaderPanel, EXPECTED, ORIGIN);
  await missingHeader.start();
  missingHeader.arm();
  missingHeaderPanel.emit({ organizationId: null });
  await assert.rejects(() => missingHeader.verify(), /d87_member_logical_organization_mismatch/);
  missingHeader.stop();

  const failedPanel = networkPanel();
  const failed = observeMemberLogicalOrganizationGet(failedPanel, EXPECTED, ORIGIN);
  await failed.start();
  failed.arm();
  failedPanel.emit({ status: 503 });
  await assert.rejects(() => failed.verify(), /d87_member_logical_organization_get_failed/);
  failed.stop();

  const duplicatePanel = networkPanel();
  const duplicate = observeMemberLogicalOrganizationGet(duplicatePanel, EXPECTED, ORIGIN);
  await duplicate.start();
  duplicate.arm();
  duplicatePanel.emit();
  duplicatePanel.emit();
  await assert.rejects(() => duplicate.verify(), /d87_member_logical_organization_ambiguous/);
  duplicate.stop();
});
