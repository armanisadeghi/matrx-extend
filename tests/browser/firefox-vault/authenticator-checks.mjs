import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createAuthenticatorPreservation } = createRequire(import.meta.url)(
  '../vault-authenticator-preservation.cjs',
);

/** Keeps enrollment and cleanup restricted to a receipt-owned matrix item. */
export function createFirefoxAuthenticatorChecks({ request, persist, proof, getOwnedItemIds }) {
  assert.equal(typeof request, 'function');
  assert.equal(typeof persist, 'function');
  assert.equal(typeof getOwnedItemIds, 'function');
  let selectedId = null;
  let handle = null;
  let cleaned = false;
  const owner = createAuthenticatorPreservation({
    request: async ({ method, path, body }) => {
      assert.ok(
        selectedId && getOwnedItemIds().includes(selectedId),
        'firefox_authenticator_item_not_owned',
      );
      const itemPath = `/${encodeURIComponent(selectedId)}`;
      const allowed =
        (method === 'POST' && path === '/enroll' && body?.credential_item_id === selectedId) ||
        (method === 'GET' && (path === itemPath || path === `${itemPath}/code`)) ||
        (method === 'DELETE' && path === itemPath);
      assert.ok(allowed, 'firefox_authenticator_route_not_owned');
      return request({ method, path, ...(body !== undefined && { body }) });
    },
    markCleanupObligation: async (value) => {
      handle = value;
      proof.authenticator = {
        credentialItemId: selectedId,
        cleanupObligationArmed: true,
        enrolled: false,
        preserved: false,
        cleanupProven: false,
      };
      await persist();
    },
    journal: (entry) => {
      (proof.authenticatorJournal ||= []).push(entry);
    },
  });
  return {
    async beforeUpdate({ selected }) {
      assert.equal(selectedId, null, 'firefox_authenticator_already_started');
      assert.ok(
        selected?.itemId && getOwnedItemIds().includes(selected.itemId),
        'firefox_authenticator_selected_item_not_owned',
      );
      selectedId = selected.itemId;
      handle = await owner.beforeUpdate({ credentialItemId: selectedId });
      assert.ok(
        handle.enrolled && !handle.acceptanceFailed,
        'firefox_authenticator_enrollment_failed',
      );
      proof.authenticator.enrolled = true;
      await persist();
    },
    async afterUpdate() {
      assert.ok(handle && !cleaned, 'firefox_authenticator_handle_missing');
      assert.equal(await owner.afterUpdate(handle), true, 'firefox_authenticator_not_preserved');
      proof.authenticator.preserved = true;
      await persist();
    },
    async cleanup() {
      if (!handle || cleaned) return;
      assert.equal(await owner.cleanup(handle), true, 'firefox_authenticator_cleanup_unproven');
      cleaned = true;
      proof.authenticator.cleanupProven = true;
      await persist();
    },
  };
}
