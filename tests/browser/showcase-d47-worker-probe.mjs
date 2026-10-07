import assert from 'node:assert/strict';

export async function installPassiveWorkerProbe(worker, origin, onAttempt) {
  await worker.send('Runtime.enable');
  onAttempt();
  const result = await worker.send('Runtime.evaluate', {
    expression: `(() => {
      if (globalThis.__d47PassiveProbe) throw new Error('probe_already_installed');
      const observed = [];
      const origin = ${JSON.stringify(origin)};
      const pending = [];
      const listener = (source, method, params = {}) => {
        if (!Number.isInteger(source.tabId) || source.sessionId) return;
        const order = observed.length + 1;
        if (method === 'Runtime.executionContextCreated') {
          const c = params.context;
          if (c?.auxData?.isDefault) observed.push({ order, kind: 'context_created', tab_id: source.tabId, id: c.id, unique_id: c.uniqueId ?? null, frame_id: c.auxData.frameId ?? null });
        } else if (method === 'Runtime.executionContextDestroyed') {
          observed.push({ order, kind: 'context_destroyed', tab_id: source.tabId, id: params.executionContextId });
        } else if (method === 'Runtime.executionContextsCleared') {
          observed.push({ order, kind: 'contexts_cleared', tab_id: source.tabId });
        } else if (method === 'Page.frameNavigated' && !params.frame?.parentId) {
          observed.push({ order, kind: 'frame_navigated', tab_id: source.tabId, frame_id: params.frame?.id ?? null, current_fixture: params.frame?.url === origin + '/document-race/' });
        } else if (method === 'Runtime.bindingCalled' && String(params.name).startsWith('__matrx_capture_')) {
          let packet = null;
          try { packet = JSON.parse(params.payload); } catch { /* malformed marker below */ }
          const event = { order, kind: 'binding', tab_id: source.tabId, context_id: params.executionContextId,
            binding_name: params.name,
            handshake: packet?.__matrx_capture_hook === 'network-tap',
            target_packet: packet?.url === origin + '/api/document-race',
            probe_packet: packet?.url === origin + '/api/race-warmup',
            url: [origin + '/api/document-race', origin + '/api/race-warmup'].includes(packet?.url) ? packet.url : null,
            method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(packet?.method) ? packet.method : null,
            source: ['fetch', 'xhr'].includes(packet?.source) ? packet.source : null,
            request_body_key: packet?.request_body_key === 'none' ? 'none' : 'other',
            status: packet?.status ?? null,
            request_sequence: Number.isSafeInteger(packet?.request_sequence) ? packet.request_sequence : null,
            current_payload: packet?.body === ${JSON.stringify(JSON.stringify({ events: [{ eventName: 'Canyon Frequency' }], document: 'current' }))},
            old_payload: typeof packet?.body === 'string' && packet.body.includes('Moonlit Transit'), body_sha256: null };
          observed.push(event);
          if (typeof packet?.body === 'string') pending.push(crypto.subtle.digest('SHA-256', new TextEncoder().encode(packet.body))
            .then(bytes => { event.body_sha256 = [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join(''); }));
        }
      };
      globalThis.__d47PassiveProbe = { observed, listener, pending };
      chrome.debugger.onEvent.addListener(listener);
      return true;
    })()`,
    returnByValue: true,
  });
  assert.equal(result.result?.value, true, 'worker_probe_install_failed');
}
export async function readPassiveWorkerProbe(worker) {
  const result = await worker.send('Runtime.evaluate', {
    expression:
      '(async () => { const p = globalThis.__d47PassiveProbe; if (!p) return null; await Promise.all(p.pending); return p.observed; })()',
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value ?? null;
}
export async function removePassiveWorkerProbe(worker) {
  const result = await worker.send('Runtime.evaluate', {
    expression: `(() => { const probe = globalThis.__d47PassiveProbe;
      if (!probe) return true;
      chrome.debugger.onEvent.removeListener(probe.listener);
      const removed = !chrome.debugger.onEvent.hasListener(probe.listener);
      if (removed) delete globalThis.__d47PassiveProbe;
      return removed; })()`,
    returnByValue: true,
  });
  assert.equal(result.result?.value, true, 'worker_probe_remove_unconfirmed');
}
