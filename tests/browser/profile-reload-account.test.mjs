import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeReloadAccountReady } from './profile-reload-account.mjs';

const guest = {
  signed_in_account_count: 0,
  guest_account_count: 1,
  persisted_identity_matches: true,
  persisted_organization_matches: true,
  access_token_present: true,
  auth_error_visible: false,
};
const ready = { ...guest, signed_in_account_count: 1, guest_account_count: 0 };

test('reload waits for rendered account after persisted identity survives', async () => {
  const report = {};
  let reads = 0;
  const result = await observeReloadAccountReady(
    report,
    async () => {
      reads++;
      return reads < 3 ? guest : ready;
    },
    1000,
  );
  assert.equal(result, ready);
  assert.equal(report.reload_auth.status, 'ready_after_wait');
  assert.equal(report.reload_auth.before, guest);
  assert.equal(report.reload_auth.after, ready);
  assert.equal(reads, 3);
});

test('reload keeps the unresolved guest state when signed-in account never renders', async () => {
  const report = {};
  await assert.rejects(
    observeReloadAccountReady(report, async () => guest, 1),
    /profile_reload_authenticated_menu_ready_not_observed/,
  );
  assert.equal(report.reload_auth.status, 'not_ready');
  assert.equal(report.reload_auth.before, guest);
  assert.equal(report.reload_auth.last, guest);
});
