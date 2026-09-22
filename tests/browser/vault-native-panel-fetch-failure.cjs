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
  let observerErrors = 0;
  let state = 'active';
  const pending = new Set();
  const track = (work) => { const task = Promise.resolve(work).catch(() => { observerErrors += 1; }).finally(() => pending.delete(task)); pending.add(task); };
  const paused = (method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    if (state === 'disposed') return;
    track((async () => {
    const request = params?.request;
    const matches = state === 'active' && request?.method === 'GET' && request?.url === endpoint;
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
    })());
  };
  let unsubscribe = null;
  return {
    async install() {
      if (installed || disposed) throw new Error('vault_native_fetch_install_invalid');
      unsubscribe = panel.onEvent(paused);
      try { await panel.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }); }
      catch (error) { unsubscribe(); unsubscribe = null; throw error; }
      installed = true;
    },
    snapshot() { return Object.freeze({ installed, disposed, mode, matchingRequests, refusedRequests, continuedRequests, observerErrors, pendingTasks: pending.size }); },
    async dispose() {
      if (disposed) return;
      state = 'disposing';
      await Promise.allSettled([...pending]);
      let disableError;
      try { await panel.send('Fetch.disable'); } catch (error) { disableError = error; }
      await Promise.allSettled([...pending]);
      if (typeof unsubscribe === 'function') unsubscribe();
      state = 'disposed'; disposed = true;
      if (disableError) throw disableError;
      if (observerErrors || pending.size) throw new Error('vault_native_fetch_disposal_unclean');
    },
  };
}

exports.createNativePanelFetchFailure = createNativePanelFetchFailure;
