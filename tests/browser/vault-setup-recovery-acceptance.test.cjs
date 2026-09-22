'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createVaultListTransportFailure } = require('./vault-setup-recovery-acceptance.cjs');

const API = 'https://server.example.test';
const PANEL = 'chrome-extension://owned/sidepanel.html';
const OWN_LIST = `${API}/api/vault/items?principal_type=user`;

class Context {
  async route(url, handler) { this.url = url; this.handler = handler; }
  async unroute(url, handler) { assert.equal(url, this.url); assert.equal(handler, this.handler); this.unrouted = true; }
  async dispatch(request) {
    const route = {
      continued: 0,
      fulfilled: [],
      aborted: [],
      async continue() { this.continued += 1; },
      async fulfill(value) { this.fulfilled.push(value); },
      async abort(value) { this.aborted.push(value); },
    };
    await this.handler(route, request);
    return route;
  }
}

const request = ({ url = OWN_LIST, method = 'GET', frame = PANEL } = {}) => ({
  url: () => url,
  method: () => method,
  frame: () => ({ url: () => frame }),
});

test('forbidden transport failure is panel-and-route scoped and removable', async () => {
  const context = new Context();
  const fault = createVaultListTransportFailure({ context, apiOrigin: API, exactPanelDocumentUrl: PANEL, mode: 'forbidden' });
  await fault.install();
  const refused = await context.dispatch(request());
  assert.deepEqual(refused.fulfilled, [{ status: 403, contentType: 'application/json', body: '{}' }]);
  const unrelated = await context.dispatch(request({ frame: 'https://untrusted.example/' }));
  assert.equal(unrelated.continued, 1);
  assert.deepEqual(fault.snapshot(), { installed: true, disposed: false, mode: 'forbidden', matchingRequests: 1, refusedRequests: 1, continuedRequests: 1 });
  await fault.dispose();
  assert.equal(context.unrouted, true);
});

test('offline transport failure aborts only the exact panel own-list GET', async () => {
  const context = new Context();
  const fault = createVaultListTransportFailure({ context, apiOrigin: API, exactPanelDocumentUrl: PANEL, mode: 'offline' });
  await fault.install();
  const refused = await context.dispatch(request());
  assert.deepEqual(refused.aborted, ['failed']);
  const shared = await context.dispatch(request({ url: `${API}/api/vault/shared-with-me` }));
  assert.equal(shared.continued, 1);
  await fault.dispose();
});
