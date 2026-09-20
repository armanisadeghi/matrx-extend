'use strict';

const VAULT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ITEMS_PATH = '/api/vault/items';
const MATCHES_PATH = '/api/vault/browser-login/matches';
const FILTER = [{ type: 'page' }, { exclude: true }];
const ATTACH_TIMEOUT_MS = 1_000;
const DETACH_TIMEOUT_MS = 5_000;

function classifyVaultRequest({ url, method, apiOrigin }) {
  let parsed;
  try { parsed = new URL(url); } catch { return { inVault: false, mutation: false, metadataRead: false, itemCreate: false }; }
  const normalizedMethod = String(method ?? '').toUpperCase();
  const inVault = parsed.origin === apiOrigin && parsed.pathname.startsWith('/api/vault/');
  const metadataRead = inVault && normalizedMethod === 'POST' && parsed.pathname === MATCHES_PATH;
  return { inVault, mutation: inVault && VAULT_METHODS.has(normalizedMethod) && !metadataRead, metadataRead, itemCreate: inVault && normalizedMethod === 'POST' && parsed.pathname === ITEMS_PATH, method: normalizedMethod, pathname: parsed.pathname };
}

function createVaultNetworkJournal({ cdp, apiOrigin, ownedLocalOrigin, onVaultRequest = () => {} }) {
  if (!cdp?.send || !cdp?.on || !cdp?.off || typeof apiOrigin !== 'string') throw new Error('vault_network_cdp_required');
  let started = false, disposing = false, disposed = false, observerError = false, boundTarget = null, boundSession = null, disposePromise, cleanupPhase = 'idle', lastSendFailureClass = 'none';
  let mutations = 0, metadata = 0, pageRequestCount = 0, ownedLocalPageRequestCount = 0, enableSuccessBeforeResume = true, requestSeen = false, responseSeen = false;
  const targets = new Map(), targetSessions = new Map(), canonicalSessions = new Map(), tasks = new Set(), binds = new Map(), attachedWaiters = new Map(), detachWaiters = new Map();
  const fail = () => { if (!disposed) observerError = true; };
  const addTask = (promise) => { tasks.add(promise); promise.finally(() => tasks.delete(promise)); return promise; };
  const send = async (method, params, sessionId) => {
    try { return await cdp.send(method, params, sessionId); }
    catch {
      lastSendFailureClass = method === 'Target.setAutoAttach' ? 'autoattach' : method === 'Target.attachToTarget' ? 'attach' : method === 'Target.detachFromTarget' ? 'target_detach' : method === 'Runtime.runIfWaitingForDebugger' ? 'resume' : method === 'Network.enable' ? 'network_enable' : 'other';
      fail(); throw new Error('vault_network_protocol_failed');
    }
  };
  const resume = async (target) => {
    if (!target.paused || target.detached) return;
    try { await send('Runtime.runIfWaitingForDebugger', {}, target.sessionId); target.paused = false; target.resumed = true; } catch { fail(); }
  };
  const sessionsFor = (targetId) => [...(targetSessions.get(targetId) ?? [])].map((id) => targets.get(id)).filter(Boolean);
  const observingFor = (targetId) => {
    const canonical = targets.get(canonicalSessions.get(targetId));
    return canonical?.setupDone && canonical.enabled && !canonical.detached && !canonical.detaching ? canonical : undefined;
  };
  const freshEpoch = (target) => { boundTarget = target.targetId; boundSession = target.sessionId; requestSeen = false; responseSeen = false; target.requests.clear(); };
  const promote = (target) => {
    if (target.sessionId !== boundSession) return;
    const entries = [...target.requests.values()];
    requestSeen = entries.some((entry) => entry.items);
    responseSeen = entries.some((entry) => entry.items && entry.ok);
  };
  const removeTarget = (target) => {
    target.detached = true; targets.delete(target.sessionId);
    const ids = targetSessions.get(target.targetId);
    ids?.delete(target.sessionId);
    if (ids?.size === 0) targetSessions.delete(target.targetId);
    if (canonicalSessions.get(target.targetId) === target.sessionId) canonicalSessions.delete(target.targetId);
    if (target.sessionId === boundSession) { boundSession = null; requestSeen = false; responseSeen = false; }
  };
  const waitForAttached = (sessionId, targetId) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { attachedWaiters.delete(sessionId); fail(); reject(new Error('vault_network_panel_attach_timeout')); }, ATTACH_TIMEOUT_MS);
    attachedWaiters.set(sessionId, { targetId, resolve, reject, timer });
  });
  const settleWaiter = (sessionId, target) => {
    const waiter = attachedWaiters.get(sessionId);
    if (!waiter) return;
    attachedWaiters.delete(sessionId); clearTimeout(waiter.timer);
    if (waiter.targetId !== target.targetId) { fail(); waiter.reject(new Error('vault_network_panel_attach_mismatch')); return; }
    waiter.resolve(target);
  };
  const waitForDetached = (target) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { detachWaiters.delete(target.sessionId); fail(); reject(new Error('vault_network_redundant_detach_timeout')); }, DETACH_TIMEOUT_MS);
    detachWaiters.set(target.sessionId, { resolve, reject, timer });
  });
  const detachTarget = (target) => {
    if (target.detached || !targets.has(target.sessionId)) return Promise.resolve();
    if (target.detachPromise) return target.detachPromise;
    target.detaching = true;
    target.detachPromise = (async () => {
      const detached = waitForDetached(target);
      try { await send('Target.detachFromTarget', { sessionId: target.sessionId }); }
      catch (error) {
        const waiter = detachWaiters.get(target.sessionId);
        if (waiter) { detachWaiters.delete(target.sessionId); clearTimeout(waiter.timer); waiter.reject(error); }
        await detached.catch(() => {});
        fail();
        throw error;
      }
      try { await detached; }
      catch (error) { fail(); throw error; }
    })();
    // Reconciliation is fail-closed through observerError; do not leave an
    // unhandled promise while its owning bind/dispose drains the task set.
    addTask(target.detachPromise.catch(() => {}));
    return target.detachPromise;
  };
  const reconcileTarget = (target) => {
    if (!target.setupDone || target.detached || target.detaching) return;
    const canonical = observingFor(target.targetId);
    if (!canonical) { canonicalSessions.set(target.targetId, target.sessionId); return; }
    if (canonical.sessionId !== target.sessionId) detachTarget(target).catch(() => {});
  };
  const setup = async (params, manual) => {
    const sessionId = params?.sessionId, info = params?.targetInfo;
    if (!sessionId || info?.type !== 'page') { fail(); return null; }
    const existing = targets.get(sessionId);
    if (existing) {
      // A returned session is correlated once. A second attach event is neither a
      // valid manual correlation nor an additional observer.
      fail();
      return existing;
    }
    const target = { sessionId, targetId: info.targetId, manual, paused: params.waitingForDebugger === true, enabled: false, resumed: false, setupDone: false, detached: false, requests: new Map() };
    targets.set(sessionId, target);
    if (!targetSessions.has(target.targetId)) targetSessions.set(target.targetId, new Set());
    targetSessions.get(target.targetId).add(sessionId);
    settleWaiter(sessionId, target);
    try { if (!disposing) { await send('Network.enable', {}, sessionId); target.enabled = true; } }
    catch { fail(); }
    finally {
      if (target.paused) { if (!target.enabled) enableSuccessBeforeResume = false; await resume(target); }
      target.setupDone = target.enabled && !target.detached;
      reconcileTarget(target);
    }
    return target;
  };
  const onAttached = (params) => {
    if (disposed) return;
    addTask(setup(params, attachedWaiters.has(params?.sessionId)));
  };
  const onDetached = (params) => {
    const sessionId = params?.sessionId, waiter = attachedWaiters.get(sessionId);
    if (waiter) { attachedWaiters.delete(sessionId); clearTimeout(waiter.timer); fail(); waiter.reject(new Error('vault_network_panel_attach_detached')); }
    const target = targets.get(sessionId);
    if (!target || target.detached) { fail(); return; }
    const detachWaiter = detachWaiters.get(sessionId);
    if (detachWaiter) { detachWaiters.delete(sessionId); clearTimeout(detachWaiter.timer); detachWaiter.resolve(); }
    removeTarget(target);
    const replacement = sessionsFor(target.targetId).find((candidate) => candidate.setupDone && candidate.enabled && !candidate.detached && !candidate.detaching);
    if (replacement) canonicalSessions.set(target.targetId, replacement.sessionId);
  };
  const onRequest = (params, sessionId) => {
    const target = targets.get(sessionId);
    if (!target || disposed || target.detaching || canonicalSessions.get(target.targetId) !== sessionId) return;
    pageRequestCount += 1;
    let origin = ''; try { origin = new URL(params.request?.url).origin; } catch {}
    if (origin === ownedLocalOrigin) ownedLocalPageRequestCount += 1;
    const c = classifyVaultRequest({ url: params.request?.url, method: params.request?.method, apiOrigin });
    const old = target.requests.get(params.requestId);
    const entry = { ordinal: (old?.ordinal ?? 0) + 1, items: c.inVault && c.method === 'GET' && c.pathname === ITEMS_PATH, c };
    target.requests.set(params.requestId, entry); promote(target);
    if (!c.inVault) return;
    if (c.mutation) mutations += 1;
    if (c.metadataRead) metadata += 1;
    try { onVaultRequest({ method: c.method, pathname: c.pathname, headers: params.request?.headers ?? {}, itemCreate: c.itemCreate, mutation: c.mutation, metadataRead: c.metadataRead }); } catch { fail(); }
  };
  const onResponse = (params, sessionId) => {
    const target = targets.get(sessionId), entry = target?.requests.get(params.requestId);
    if (!target || !entry?.items || disposed || target.detaching || canonicalSessions.get(target.targetId) !== sessionId) return;
    if (Number.isInteger(params.response?.status) && params.response.status >= 200 && params.response.status < 300) { entry.ok = true; promote(target); }
  };
  const drain = async () => { while (tasks.size) await Promise.allSettled([...tasks]); };
  const drainDetached = async () => {
    const deadline = Date.now() + DETACH_TIMEOUT_MS;
    while (targets.size && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return targets.size === 0;
  };
  const bind = async (targetId) => {
    if (!started || disposing || disposed || typeof targetId !== 'string' || !targetId) throw new Error('vault_network_panel_bind_unavailable');
    await drain();
    const already = observingFor(targetId);
    if (already) { freshEpoch(already); return { targetId, sessionId: already.sessionId }; }
    const attached = await send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) { fail(); throw new Error('vault_network_panel_attach_missing'); }
    let target = targets.get(sessionId);
    if (target) {
      if (target.targetId !== targetId) { fail(); throw new Error('vault_network_panel_attach_mismatch'); }
      target.manual = true;
    } else {
      target = await waitForAttached(sessionId, targetId);
      target.manual = true;
    }
    await drain();
    if (target.targetId !== targetId || !target.setupDone || !target.enabled) { fail(); throw new Error('vault_network_panel_setup_failed'); }
    await drain();
    const canonical = observingFor(targetId);
    if (!canonical) { fail(); throw new Error('vault_network_panel_setup_failed'); }
    target = canonical;
    freshEpoch(target);
    return { targetId, sessionId: target.sessionId };
  };
  return {
    async start() {
      if (started) return;
      started = true;
      cdp.on('Target.attachedToTarget', onAttached); cdp.on('Target.detachedFromTarget', onDetached); cdp.on('Network.requestWillBeSent', onRequest); cdp.on('Network.responseReceived', onResponse);
      try { await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: FILTER }); } catch { throw new Error('vault_network_autoattach_failed'); }
    },
    bindPanelTarget(targetId) {
      if (binds.has(targetId)) return binds.get(targetId);
      const promise = bind(targetId).finally(() => binds.delete(targetId));
      binds.set(targetId, promise);
      return promise;
    },
    async settle() { await drain(); await Promise.allSettled([...binds.values()]); },
    snapshot() {
      const bound = boundTarget ? sessionsFor(boundTarget) : [];
      const canonical = boundSession ? [targets.get(boundSession)].filter(Boolean) : [];
      const boundRequests = canonical.flatMap((target) => [...target.requests.values()]);
      return { boundTargetAttached: canonical.length > 0, boundTargetSessionCount: bound.length, boundTargetCountingSessionCount: canonical.length, boundTargetRequestCount: boundRequests.length, boundTargetVaultRequestCount: boundRequests.filter((entry) => entry.c.inVault).length, boundTargetItemsAnyOriginCount: boundRequests.filter((entry) => entry.c.pathname === ITEMS_PATH).length, journalSemanticVersion: 2, vaultMutationRequests: mutations, vaultMetadataReadRequests: metadata, pageRequestCount, ownedLocalPageRequestCount, enableSuccessBeforeResume, panelItemsReadRequestSeen: requestSeen, panelItemsReadResponse2xxSeen: responseSeen, observerError, cleanupPhase, remainingOwnedSessionCount: targets.size, pendingSetupCount: tasks.size + binds.size, transportFatal: cdp.fatal === true, transportFailureClass: typeof cdp.failureClass === 'string' ? cdp.failureClass : 'unknown', sendFailureClass: lastSendFailureClass, transportCloseStatus: typeof cdp.closeStatus === 'string' ? cdp.closeStatus : 'unknown' };
    },
    async assertCoverage() {
      await drain(); await Promise.all([...binds.values()]);
      if (observerError || cdp.fatal) throw new Error('vault_network_observer_failed');
      if (!requestSeen || !responseSeen) throw new Error('vault_panel_items_read_sentinel_missing');
    },
    async dispose() {
      if (disposePromise) return disposePromise;
      disposePromise = (async () => {
        disposing = true; cleanupPhase = 'resuming'; let cleanup = false;
        for (const target of targets.values()) if (target.paused) await resume(target);
        cleanupPhase = 'disabling_autoattach';
        try { await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }); } catch { cleanup = true; }
        cleanupPhase = 'draining_setup'; await drain(); await Promise.allSettled([...binds.values()]);
        cleanupPhase = 'detaching_manual';
        for (const target of [...targets.values()]) if (target.manual && !target.detached) await detachTarget(target).catch(() => { cleanup = true; });
        cleanupPhase = 'waiting_detach';
        if (!(await drainDetached())) cleanup = true;
        cdp.off('Target.attachedToTarget', onAttached); cdp.off('Target.detachedFromTarget', onDetached); cdp.off('Network.requestWillBeSent', onRequest); cdp.off('Network.responseReceived', onResponse);
        cleanupPhase = 'closing_transport';
        try { await cdp.detach(); } catch { cleanup = true; }
        disposed = true; cleanupPhase = cleanup || observerError || cdp.fatal ? 'failed' : 'complete';
        if (cleanup || observerError || cdp.fatal) throw new Error('vault_network_cleanup_failed');
      })();
      return disposePromise;
    },
  };
}

exports.classifyVaultRequest = classifyVaultRequest;
exports.createVaultNetworkJournal = createVaultNetworkJournal;
