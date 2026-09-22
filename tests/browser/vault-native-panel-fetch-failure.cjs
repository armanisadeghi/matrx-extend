'use strict';

function createNativePanelFetchFailure({ panel, apiOrigin, mode }) {
  if (!panel?.send || !panel?.onEvent) throw new Error('vault_native_fetch_panel_missing');
  if (!['forbidden', 'offline'].includes(mode)) throw new Error('vault_native_fetch_mode_invalid');
  const endpoint = new URL('/api/vault/items?principal_type=user', apiOrigin).href;
  let installed = false;
  let disposed = false;
  let matchingRequests = 0;
  let refusedRequests = 0;
  let continuedRequests = 0;
  const paused = async (method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    const request = params?.request;
    const matches = request?.method === 'GET' && request?.url === endpoint;
    if (!matches) {
      continuedRequests += 1;
      await panel.send('Fetch.continueRequest', { requestId: params.requestId });
      return;
    }
    matchingRequests += 1;
    refusedRequests += 1;
    if (mode === 'forbidden') {
      await panel.send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 403,
        responseHeaders: [{ name: 'content-type', value: 'application/json' }],
        body: Buffer.from('{}').toString('base64'),
      });
      return;
    }
    await panel.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' });
  };
  let unsubscribe = null;
  return {
    async install() {
      if (installed || disposed) throw new Error('vault_native_fetch_install_invalid');
      await panel.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      unsubscribe = panel.onEvent(paused);
      installed = true;
    },
    snapshot() { return Object.freeze({ installed, disposed, mode, matchingRequests, refusedRequests, continuedRequests }); },
    async dispose() {
      if (disposed) return;
      try { if (typeof unsubscribe === 'function') unsubscribe(); }
      finally { await panel.send('Fetch.disable'); disposed = true; }
    },
  };
}

exports.createNativePanelFetchFailure = createNativePanelFetchFailure;
