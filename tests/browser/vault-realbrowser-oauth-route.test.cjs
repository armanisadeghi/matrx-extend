'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runner = fs.readFileSync(path.join(__dirname, 'vault-realbrowser-acceptance.cjs'), 'utf8');
const match = runner.match(/async function readOAuthPageSnapshot[\s\S]*?\n}\n\nlet cdpWorkerMessageId/);
assert.ok(match, 'oauth_route_observer_missing');
const functionSource = match[0].replace(/\nlet cdpWorkerMessageId$/, '');
const sandbox = { URL, wait: async () => {}, setTimeout, clearTimeout, assert: (value, code) => { if (!value) throw new Error(code); } };
vm.createContext(sandbox);
new vm.Script(`${functionSource}; globalThis.readSnapshot = readOAuthPageSnapshot; globalThis.classifyConsent = classifyOAuthConsentSnapshot; globalThis.observe = awaitOAuthRouteOrCallback; globalThis.observeCallback = awaitOAuthCallbackStorage; globalThis.observeApproval = observeOAuthConsentApproval; globalThis.observePostPassword = observeOAuthPostPasswordSubmission; globalThis.finalizePostPassword = finalizeOAuthPostPasswordSubmission; globalThis.failPostPassword = failOAuthPostPasswordSubmission; globalThis.submitPostPassword = submitOAuthPasswordWithDiagnostics;`).runInContext(sandbox);

const exactLocator = (entries) => ({
  count: async () => entries.length,
  nth: (index) => ({
    isVisible: async () => entries[index]?.visible === true,
    textContent: async () => entries[index]?.text ?? '',
  }),
  isVisible: async () => entries[0]?.visible === true,
  isEnabled: async () => entries[0]?.enabled === true,
  waitFor: async () => {},
  click: async () => {},
});
const page = ({ url = 'https://www.aimatrx.com/auth', email = false, password = false, authorize = [], retry = [], loginSubmit = [], headings = [], closed = false, snapshotHangs = false } = {}) => {
  const listeners = new Set();
  return {
    isClosed: () => closed,
    url: () => url,
    evaluate: async () => snapshotHangs ? new Promise(() => {}) : ({
      emailVisible: email,
      passwordVisible: password,
      authorizeCount: authorize.filter((entry) => entry.visible).length,
      enabledAuthorizeCount: authorize.filter((entry) => entry.visible && entry.enabled).length,
      retryCount: retry.filter((entry) => entry.visible).length,
      loginSubmitCount: loginSubmit.filter((entry) => entry.visible).length,
      busyLoginSubmitCount: loginSubmit.filter((entry) => entry.visible && entry.busy).length,
      visibleHeadings: headings.filter((entry) => entry.visible).map((entry) => entry.text ?? ''),
    }),
    locator: (selector) => selector === '#email' ? exactLocator([{ visible: email }]) : selector === '#password' ? exactLocator([{ visible: password }]) : exactLocator(headings),
    getByRole: (role, options = {}) => exactLocator(role === 'button' && options.name === 'Authorize' ? authorize : role === 'button' && options.name === 'Try again' ? retry : []),
    getByText: (text) => exactLocator(text === 'Redirecting' ? redirecting : []),
    on: (event, listener) => { if (event === 'response') listeners.add(listener); },
    off: (event, listener) => { if (event === 'response') listeners.delete(listener); },
    responseListenerCount: () => listeners.size,
    emitApproval: (status, pathSuffix = 'authorization/consent') => {
      for (const listener of listeners) listener({ url: () => `https://db.matrxserver.com/auth/v1/oauth/authorizations/${pathSuffix}`, request: () => ({ method: () => 'POST', headers: () => ({}) }), status: () => status });
    },
    emitServerAction: (status, responseUrl = url) => {
      for (const listener of listeners) listener({ url: () => responseUrl, request: () => ({ headers: () => ({ 'next-action': 'redacted' }) }), status: () => status });
    },
  };
};
const storage = async () => ({});

(async () => {
  assert.equal(await sandbox.observe({ authPage: page({ email: true, password: true }), storage, adminEmail: 'admin@admin.com', allowLoginForm: true }), 'password_form');
  assert.equal(await sandbox.observe({ authPage: page({ url: 'https://www.aimatrx.com/oauth/consent', authorize: [{ visible: true, enabled: true }], headings: [{ visible: true, text: 'This will allow AI Matrx to:' }] }), storage, adminEmail: 'admin@admin.com' }), 'consent_ready');
  assert.equal(await sandbox.observe({ authPage: page({ url: 'https://www.aimatrx.com/oauth/consent', retry: [{ visible: true }] }), storage, adminEmail: 'admin@admin.com' }), 'consent_error');
  assert.equal(await sandbox.observe({ authPage: page({ url: 'https://www.aimatrx.com/oauth/consent', headings: [{ visible: true, text: 'Request expired' }] }), storage, adminEmail: 'admin@admin.com' }), 'consent_error');
  assert.equal(await sandbox.observe({ authPage: page({ url: 'https://www.aimatrx.com/oauth/consent', headings: [{ visible: true, text: 'Authorization error (500)' }] }), storage, adminEmail: 'admin@admin.com' }), 'consent_error');
  assert.equal(await sandbox.observe({ authPage: page({ url: 'https://www.aimatrx.com/oauth/consent', headings: [{ visible: true, text: 'Redirecting' }] }), storage, adminEmail: 'admin@admin.com' }), 'redirecting');
  await assert.rejects(() => sandbox.observe({ authPage: page({ url: 'https://www.aimatrx.com/oauth/consent', authorize: [{ visible: true, enabled: false }] }), storage, adminEmail: 'admin@admin.com' }), /oauth_consent_or_callback_timeout/, 'URL-only or disabled consent must never be accepted as rendered readiness');
  await assert.rejects(() => sandbox.observe({ authPage: page({ url: 'https://www.aimatrx.com/oauth/consent', authorize: [{ visible: true, enabled: true }, { visible: true, enabled: true }] }), storage, adminEmail: 'admin@admin.com' }), /oauth_consent_or_callback_timeout/, 'multiple exact approval controls must fail closed');
  await assert.rejects(() => sandbox.readSnapshot(page({ url: 'https://www.aimatrx.com/oauth/consent', snapshotHangs: true }), 1), /oauth_consent_dom_snapshot_timeout/, 'a stalled DOM read must fail on its own bounded timer');
  await assert.rejects(() => sandbox.observe({ authPage: page({ closed: true }), storage: async () => new Promise(() => {}), adminEmail: 'admin@admin.com', deadlineMs: 2 }), /oauth_route_observation_deadline/, 'the complete OAuth observation must have an independent hard deadline');

  const single = page(); const singleObserver = sandbox.observeApproval(single, 'https://db.matrxserver.com', 20); const singleWait = singleObserver.requireFirst2xx(); single.emitApproval(204); await singleWait;
  assert.equal(JSON.stringify(singleObserver.finish()), JSON.stringify({ route: 'oauth_authorization_consent', method: 'POST', status: 204, phase: 'after_authorize_click', count: 1 }));
  const non2xx = page(); const non2xxObserver = sandbox.observeApproval(non2xx, 'https://db.matrxserver.com', 20); const non2xxWait = non2xxObserver.requireFirst2xx(); non2xx.emitApproval(403);
  await assert.rejects(() => non2xxWait, /oauth_consent_approval_non_2xx/);
  const missing = page(); const missingObserver = sandbox.observeApproval(missing, 'https://db.matrxserver.com', 1);
  await assert.rejects(() => missingObserver.requireFirst2xx(), /oauth_consent_approval_missing/);
  const duplicate = page(); const duplicateObserver = sandbox.observeApproval(duplicate, 'https://db.matrxserver.com', 20); const duplicateWait = duplicateObserver.requireFirst2xx(); duplicate.emitApproval(200); await duplicateWait; duplicate.emitApproval(204);
  assert.throws(() => duplicateObserver.finish(), /oauth_consent_approval_count_invalid/);

  const callbackStorage = async () => ({ 'matrx.user.profile': { email: 'admin@admin.com' }, 'matrx.auth.accessToken': 'a'.repeat(21) });
  const callback = await sandbox.observeCallback({ authPage: page({ closed: true }), storage: callbackStorage, adminEmail: 'admin@admin.com' });
  assert.equal(callback.callbackStorageObserved, true); assert.equal(callback.authPageClosed, true);
  await assert.rejects(() => sandbox.observeCallback({ authPage: page(), storage, adminEmail: 'admin@admin.com' }), /oauth_callback_storage_timeout/);
  const unchangedLogin = page({ url: 'https://www.aimatrx.com/login?error', email: true, password: true });
  const unchangedObserver = sandbox.observePostPassword(unchangedLogin);
  assert.equal(JSON.stringify(await unchangedObserver.snapshot()), JSON.stringify({ formState: 'form_unchanged', routeCategory: 'login', errorQueryParameterPresent: true, serverActionResponse: null, serverActionResponseCount: 0 }));
  unchangedLogin.emitServerAction(401);
  assert.equal(JSON.stringify(await unchangedObserver.snapshot()), JSON.stringify({ formState: 'form_unchanged', routeCategory: 'login', errorQueryParameterPresent: true, serverActionResponse: { route: 'login_server_action', status: 401 }, serverActionResponseCount: 1 })); unchangedObserver.finish();
  const busyLogin = page({ url: 'https://www.aimatrx.com/login', email: true, password: true, loginSubmit: [{ visible: true, busy: true }] });
  const busyObserver = sandbox.observePostPassword(busyLogin); busyLogin.emitServerAction(303, 'https://www.aimatrx.com/oauth/consent');
  assert.equal(JSON.stringify(await busyObserver.snapshot()), JSON.stringify({ formState: 'submit_busy', routeCategory: 'login', errorQueryParameterPresent: false, serverActionResponse: { route: 'oauth_consent_server_action', status: 303 }, serverActionResponseCount: 1 })); busyObserver.finish();
  const rejectedLogin = page({ url: 'https://www.aimatrx.com/login', email: true, password: true, loginSubmit: [{ visible: true, busy: true }] });
  const rejectedObserver = sandbox.observePostPassword(rejectedLogin); const rejectedUi = {}; let persisted = 0;
  rejectedLogin.getByRole = () => ({ click: async () => { throw new Error('click_rejected'); } });
  await assert.rejects(() => sandbox.submitPostPassword(rejectedLogin, rejectedObserver, rejectedUi, () => { persisted += 1; }), /oauth_login_form_submit_failed/);
  assert.equal(persisted, 1); assert.equal(rejectedUi.failureCategory, 'oauth_login_form_submit_failed');
  assert.equal(rejectedLogin.responseListenerCount(), 0);
  assert.equal(JSON.stringify(rejectedUi.postPasswordSubmissionFinal), JSON.stringify({ formState: 'submit_busy', routeCategory: 'login', errorQueryParameterPresent: false, serverActionResponse: null, serverActionResponseCount: 0 }));
  rejectedLogin.emitServerAction(503);
  assert.equal(JSON.stringify(await rejectedObserver.snapshot()), JSON.stringify({ formState: 'submit_busy', routeCategory: 'login', errorQueryParameterPresent: false, serverActionResponse: null, serverActionResponseCount: 0 }));
  process.stdout.write('PASS: OAuth consent requires rendered readiness, one approval 2xx, and callback storage\n');
})().catch((error) => { console.error(error); process.exitCode = 1; });
