import assert from 'node:assert/strict';
import test from 'node:test';
import { enterFirstPartyRoute } from './member-chat-original-repro.mjs';

for (const resourceReady of [false, true]) {
  test(`reviewer auth tab waits for resource health and original guest turns, ready=${resourceReady}`, async () => {
    const operations = [];
    const entry = enterFirstPartyRoute({
      checkResource: async () => {
        operations.push('resource_checked');
        if (!resourceReady) throw new Error('NATIVE_RESOURCE_BOUNDARY_REFUSED:cpu_pending');
      },
      runGuest: async () => {
        operations.push('guest_opening_and_followup');
        return { status: 'terminal_two_turn_guest' };
      },
      openTab: async () => {
        operations.push('auth_page_created');
        return {};
      },
    });
    if (resourceReady) await entry;
    else await assert.rejects(entry, /NATIVE_RESOURCE_BOUNDARY_REFUSED:cpu_pending/);
    assert.deepEqual(
      operations,
      resourceReady
        ? ['resource_checked', 'guest_opening_and_followup', 'auth_page_created']
        : ['resource_checked'],
    );
  });
}
