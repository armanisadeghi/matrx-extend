'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runner = fs.readFileSync(path.join(__dirname, 'vault-realbrowser-acceptance.cjs'), 'utf8');
const match = runner.match(/async function awaitOAuthRouteOrCallback\([\s\S]*?\n}\n\nlet cdpWorkerMessageId/);
assert.ok(match, 'oauth_route_observer_missing');
const functionSource = match[0].replace(/\nlet cdpWorkerMessageId$/, '');
const sandbox = { URL, wait: async () => {} };
vm.createContext(sandbox);
new vm.Script(`${functionSource}; globalThis.observe = awaitOAuthRouteOrCallback;`).runInContext(sandbox);

const page = ({ url = 'https://www.aimatrx.com/auth', email = false, password = false, closed = false } = {}) => ({
  isClosed: () => closed,
  url: () => url,
  locator: (selector) => ({ isVisible: async () => selector === '#email' ? email : password }),
});
const storage = async () => ({});

(async () => {
  assert.equal(await sandbox.observe({ authPage: page({ email: true, password: true }), storage, adminEmail: 'admin@admin.com', allowLoginForm: true }), 'password_form');
  assert.equal(await sandbox.observe({ authPage: page({ url: 'https://www.aimatrx.com/oauth/consent' }), storage, adminEmail: 'admin@admin.com' }), 'consent_page');
  assert.equal(await sandbox.observe({ authPage: page({ closed: true }), storage: async () => ({ 'matrx.user.profile': { email: 'admin@admin.com' }, 'matrx.auth.accessToken': 'a'.repeat(21) }), adminEmail: 'admin@admin.com' }), 'completed_callback');
  await assert.rejects(() => sandbox.observe({ authPage: page(), storage, adminEmail: 'admin@admin.com' }), /oauth_consent_or_callback_timeout/);
  process.stdout.write('PASS: OAuth recovery distinguishes password form, existing SSO consent, and completed callback\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
