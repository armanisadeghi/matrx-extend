import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFirefoxAuthenticatorChecks } from './authenticator-checks.mjs';

const ownedId = '11111111-1111-4111-8111-111111111111';

test('refuses a nonowned authenticator target before any request', async () => {
  let requests = 0;
  const checks = createFirefoxAuthenticatorChecks({
    request: async () => {
      requests += 1;
      return { status: 404 };
    },
    persist: async () => {},
    proof: {},
    getOwnedItemIds: () => [ownedId],
  });
  await assert.rejects(
    checks.beforeUpdate({ selected: { itemId: 'unowned' } }),
    /selected_item_not_owned/,
  );
  assert.equal(requests, 0);
});

test('persistence failure prevents enrollment and retains exact cleanup obligation', async () => {
  const requests = [];
  const proof = {};
  let writes = 0;
  const checks = createFirefoxAuthenticatorChecks({
    request: async ({ method, path }) => {
      requests.push({ method, path });
      return { status: 404 };
    },
    persist: async () => {
      if (++writes === 1) throw new Error('proof_unavailable');
    },
    proof,
    getOwnedItemIds: () => [ownedId],
  });
  await assert.rejects(checks.beforeUpdate({ selected: { itemId: ownedId } }), /proof_unavailable/);
  assert.deepEqual(requests, [{ method: 'GET', path: `/${ownedId}` }]);
  await checks.cleanup();
  assert.deepEqual(requests.slice(1), [
    { method: 'DELETE', path: `/${ownedId}` },
    { method: 'GET', path: `/${ownedId}` },
  ]);
  assert.equal(proof.authenticator.cleanupProven, true);
});

test('cleanup refuses requests if receipt ownership disappears', async () => {
  let owned = true;
  let requests = 0;
  const checks = createFirefoxAuthenticatorChecks({
    request: async () => {
      requests += 1;
      return { status: 404 };
    },
    persist: async () => {
      throw new Error('proof_unavailable');
    },
    proof: {},
    getOwnedItemIds: () => (owned ? [ownedId] : []),
  });
  await assert.rejects(checks.beforeUpdate({ selected: { itemId: ownedId } }), /proof_unavailable/);
  owned = false;
  await assert.rejects(checks.cleanup(), /cleanup_unproven/);
  assert.equal(requests, 1);
});
