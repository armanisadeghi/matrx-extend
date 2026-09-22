'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNativePanelFetchFailure } = require('./vault-native-panel-fetch-failure.cjs');

class Panel {
  constructor() { this.calls = []; this.listeners = new Set(); }
  async send(method, params = {}) { this.calls.push({ method, params }); }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async emit(method, params) { for (const listener of this.listeners) await listener(method, params); }
}
const request = (url, method = 'GET', requestId = 'request') => ({ requestId, request: { url, method } });
const API = 'https://server.example.test';
const OWN = `${API}/api/vault/items?principal_type=user`;

test('native panel Fetch fault fulfills only its own-list GET and removes Fetch on cleanup', async () => {
  const panel = new Panel();
  const fault = createNativePanelFetchFailure({ panel, apiOrigin: API, mode: 'forbidden' });
  await fault.install();
  await panel.emit('Fetch.requestPaused', request(OWN, 'GET', 'own'));
  await panel.emit('Fetch.requestPaused', request(`${API}/api/vault/shared-with-me`, 'GET', 'other'));
  assert.deepEqual(fault.snapshot(), { installed: true, disposed: false, mode: 'forbidden', matchingRequests: 1, refusedRequests: 1, continuedRequests: 1 });
  assert.equal(panel.calls.find((call) => call.method === 'Fetch.fulfillRequest')?.params.responseCode, 403);
  assert.equal(panel.calls.find((call) => call.method === 'Fetch.continueRequest')?.params.requestId, 'other');
  await fault.dispose();
  assert.equal(panel.calls.at(-1).method, 'Fetch.disable');
  assert.equal(panel.listeners.size, 0);
});

test('native panel Fetch offline fault fails only its own-list GET', async () => {
  const panel = new Panel();
  const fault = createNativePanelFetchFailure({ panel, apiOrigin: API, mode: 'offline' });
  await fault.install();
  await panel.emit('Fetch.requestPaused', request(OWN));
  assert.equal(panel.calls.find((call) => call.method === 'Fetch.failRequest')?.params.errorReason, 'Failed');
  await fault.dispose();
});
