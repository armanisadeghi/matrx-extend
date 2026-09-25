'use strict';
const assert = require('node:assert/strict');
const {
  isOwnedPanelLogoutResponse,
  observeOwnedPanelLogout,
} = require('./vault-lifecycle-network-observation.cjs');
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const owned = {
  url: 'https://db.matrxserver.com/auth/v1/logout?scope=local',
  method: 'POST',
  frameUrl: `chrome-extension://${extensionId}/sidepanel.html`,
  extensionId,
};
assert.equal(isOwnedPanelLogoutResponse(owned), true);
for (const changed of [
  { method: 'GET' },
  { url: 'https://db.matrxserver.com/auth/v1/logout' },
  { url: 'https://db.matrxserver.com/auth/v1/logout?scope=global' },
  { url: 'https://db.matrxserver.com/auth/v1/logout?scope=local&unexpected=value' },
  { url: 'https://other.example/auth/v1/logout?scope=local' },
  { url: 'https://db.matrxserver.com/auth/v1/user' },
  { frameUrl: `chrome-extension://${extensionId}/popup.html` },
  { frameUrl: undefined },
])
  assert.equal(isOwnedPanelLogoutResponse({ ...owned, ...changed }), false);

const listeners = new Set();
const panel = {
  onEvent(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
const statuses = [];
const stop = observeOwnedPanelLogout({
  panel,
  extensionId,
  onResponse: ({ status }) => statuses.push(status),
});
for (const listener of listeners)
  listener('Network.requestWillBeSent', {
    requestId: 'owned',
    request: { url: owned.url, method: owned.method },
    documentURL: owned.frameUrl,
  });
for (const listener of listeners)
  listener('Network.requestWillBeSent', {
    requestId: 'global',
    request: { url: 'https://db.matrxserver.com/auth/v1/logout?scope=global', method: 'POST' },
    documentURL: owned.frameUrl,
  });
for (const listener of listeners)
  listener('Network.responseReceived', { requestId: 'global', response: { status: 204 } });
for (const listener of listeners)
  listener('Network.responseReceived', { requestId: 'owned', response: { status: 204 } });
assert.deepEqual(statuses, [204]);
stop();
assert.equal(listeners.size, 0);
// A later cleanup response cannot be reused after the Settings observer ends.
for (const listener of listeners)
  listener('Network.responseReceived', { requestId: 'owned', response: { status: 204 } });
assert.deepEqual(statuses, [204]);
process.stdout.write(
  'PASS: lifecycle logout observes only the owned Settings panel POST and raw-CDP response\n',
);
