import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { observeCanonicalAdminCheck } from './member-native-auth-proof.mjs';

const ORIGIN = 'https://example.supabase.co';
const USER = '123e4567-e89b-42d3-a456-426614174000';

function panelWithRows(rows, userId = USER) {
  const emitter = new EventEmitter();
  const panel = {
    on(event, listener) {
      emitter.on(event, listener);
      return () => emitter.off(event, listener);
    },
    async send(command) {
      if (command === 'Network.getResponseBody') return { body: JSON.stringify(rows) };
      return {};
    },
  };
  return {
    panel,
    emit() {
      emitter.emit('Network.requestWillBeSent', {
        requestId: 'owned-admin-read',
        request: {
          url: `${ORIGIN}/rest/v1/admins?select=user_id&user_id=eq.${userId}`,
          method: 'GET',
          headers: { 'Accept-Profile': 'admin' },
        },
      });
      emitter.emit('Network.responseReceived', {
        requestId: 'owned-admin-read',
        response: { status: 200 },
      });
      emitter.emit('Network.loadingFinished', { requestId: 'owned-admin-read' });
    },
  };
}

test('canonical non-admin proof requires zero admin rows for the current extension user', async () => {
  const zero = panelWithRows([]);
  const proof = observeCanonicalAdminCheck(zero.panel, ORIGIN, 200);
  await proof.start();
  zero.emit();
  assert.deepEqual(await proof.verify(USER), {
    matched_current_extension_user: true,
    http_status: 200,
    returned_rows: 0,
  });
  await proof.stop();

  for (const candidate of [
    panelWithRows([{ user_id: USER }]),
    panelWithRows([], '123e4567-e89b-42d3-a456-426614174001'),
  ]) {
    const rejected = observeCanonicalAdminCheck(candidate.panel, ORIGIN, 50);
    await rejected.start();
    candidate.emit();
    await assert.rejects(
      rejected.verify(USER),
      /reviewer_canonical_admin_assignment_read_not_observed/,
    );
    await rejected.stop();
  }
});
