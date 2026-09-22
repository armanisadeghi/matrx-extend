'use strict';
const assert = require('node:assert/strict');
const { isOwnedPanelLogoutResponse } = require('./vault-lifecycle-network-observation.cjs');
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const owned = { url: 'https://db.matrxserver.com/auth/v1/logout', method: 'POST', frameUrl: `chrome-extension://${extensionId}/sidepanel.html`, extensionId };
assert.equal(isOwnedPanelLogoutResponse(owned), true);
for (const changed of [
  { method: 'GET' },
  { url: 'https://db.matrxserver.com/auth/v1/user' },
  { frameUrl: `chrome-extension://${extensionId}/popup.html` },
  { frameUrl: undefined },
]) assert.equal(isOwnedPanelLogoutResponse({ ...owned, ...changed }), false);
process.stdout.write('PASS: lifecycle logout observes only the owned Settings panel POST\n');
