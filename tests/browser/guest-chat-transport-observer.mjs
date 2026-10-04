import assert from 'node:assert/strict';

const CHAT_PATH = '/v2/ai/mandates/extend.browser_chat';

function structuredErrorCode(body, base64Encoded) {
  try {
    const decoded = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
    const payload = JSON.parse(decoded);
    const value = payload?.code ?? payload?.error?.code ?? payload?.error;
    return typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function watchGuestAiRequests({ browserSession, attachOffscreen, panelTarget }) {
  const offscreenUrl = new URL('offscreen.html', panelTarget.url).href;
  const requests = new Map();
  const pendingCodes = new Set();
  const pausedSessions = new Set();
  const targetTasks = new Set();
  const candidateSessions = new Set();
  const confirmedSessions = new Set();
  const sessionsByTarget = new Map();
  let armedLabel = null;
  let existingOffscreen = null;
  let autoAttach = false;
  let observerFailure = null;
  const counters = {
    attached: 0,
    identity_changed: 0,
    network_enabled: 0,
    request_events: 0,
    post_events: 0,
    chat_path_events: 0,
    response_events: 0,
  };
  const classifyUrl = (url) =>
    !url || url === 'about:blank' ? 'provisional' : url === offscreenUrl ? 'offscreen' : 'other';

  const onRequest = ({ requestId, request }, sessionId) => {
    counters.request_events++;
    if (request?.method === 'POST') counters.post_events++;
    try {
      if (new URL(request?.url).pathname.endsWith(CHAT_PATH)) counters.chat_path_events++;
    } catch {}
    if (
      (!confirmedSessions.has(sessionId) && !candidateSessions.has(sessionId)) ||
      !armedLabel ||
      request?.method !== 'POST'
    )
      return;
    try {
      if (!new URL(request.url).pathname.endsWith(CHAT_PATH)) return;
      requests.set(`${sessionId}:${requestId}`, {
        sessionId,
        record: {
          attempt: armedLabel,
          request_at_utc: new Date().toISOString(),
          cdp_request_id: requestId,
          status: null,
          code: null,
        },
      });
    } catch {
      // Never retain unrelated URLs, headers, or request bodies.
    }
  };
  const onResponse = ({ requestId, response }, sessionId) => {
    counters.response_events++;
    const entry = requests.get(`${sessionId}:${requestId}`);
    if (entry) entry.record.status = Number.isFinite(response?.status) ? response.status : null;
  };
  const onFinished = (
    { requestId },
    sessionId,
    send = (method, params) => browserSession.send(method, params, sessionId),
  ) => {
    const request = requests.get(`${sessionId}:${requestId}`)?.record;
    if (!request || request.status === null || request.status < 400) return;
    const pending = send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        request.code = structuredErrorCode(body, base64Encoded);
      })
      .catch(() => {});
    pendingCodes.add(pending);
    void pending.finally(() => pendingCodes.delete(pending));
  };
  const onAttached = ({ sessionId, targetInfo, waitingForDebugger }) => {
    counters.attached++;
    const provisional = classifyUrl(targetInfo?.url) === 'provisional';
    if (waitingForDebugger) pausedSessions.add(sessionId);
    if (targetInfo?.targetId) sessionsByTarget.set(targetInfo.targetId, sessionId);
    if (provisional) candidateSessions.add(sessionId);
    const task = (async () => {
      try {
        // An empty initial URL can become offscreen.html only after resume.
        // Enable Network first and buffer only classified POST metadata until
        // Target.targetInfoChanged establishes the exact document identity.
        if (targetInfo?.url === offscreenUrl || provisional) {
          await browserSession.send('Network.enable', {}, sessionId);
          counters.network_enabled++;
          if (targetInfo?.url === offscreenUrl) confirmedSessions.add(sessionId);
        }
      } catch {
        observerFailure = 'guest_offscreen_network_enable_failed';
      } finally {
        if (waitingForDebugger) {
          try {
            await browserSession.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
            pausedSessions.delete(sessionId);
          } catch {
            observerFailure = 'guest_autoattached_target_resume_failed';
          }
        }
      }
    })();
    targetTasks.add(task);
    void task.finally(() => targetTasks.delete(task));
  };
  const onTargetInfoChanged = ({ targetInfo }) => {
    counters.identity_changed++;
    const sessionId = sessionsByTarget.get(targetInfo?.targetId);
    if (!sessionId || !targetInfo?.url || targetInfo.url === 'about:blank') return;
    candidateSessions.delete(sessionId);
    if (targetInfo.url === offscreenUrl) {
      confirmedSessions.add(sessionId);
    } else {
      for (const [key, entry] of requests) {
        if (entry.sessionId === sessionId) requests.delete(key);
      }
    }
  };

  browserSession.on('Network.requestWillBeSent', onRequest);
  browserSession.on('Network.responseReceived', onResponse);
  browserSession.on('Network.loadingFinished', onFinished);
  browserSession.on('Target.attachedToTarget', onAttached);
  browserSession.on('Target.targetInfoChanged', onTargetInfoChanged);
  try {
    try {
      existingOffscreen = await attachOffscreen();
      await existingOffscreen.send('Network.enable');
      counters.network_enabled++;
    } catch (error) {
      if (error?.message !== 'native_sidepanel_offscreen_target_missing') throw error;
      // Navigation identity events require discovery, independently of auto-attach.
      // This is the harness's owned browser session: discovery remains enabled
      // until that session closes, preserving existing and later consumers.
      await browserSession.send('Target.setDiscoverTargets', { discover: true });
      await browserSession.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
      });
      autoAttach = true;
    }
  } catch (error) {
    browserSession.off('Network.requestWillBeSent', onRequest);
    browserSession.off('Network.responseReceived', onResponse);
    browserSession.off('Network.loadingFinished', onFinished);
    browserSession.off('Target.attachedToTarget', onAttached);
    browserSession.off('Target.targetInfoChanged', onTargetInfoChanged);
    await existingOffscreen?.detachVerified();
    throw error;
  }

  const existingStops = existingOffscreen
    ? [
        existingOffscreen.on('Network.requestWillBeSent', (event) => onRequest(event, 'existing')),
        existingOffscreen.on('Network.responseReceived', (event) => onResponse(event, 'existing')),
        existingOffscreen.on('Network.loadingFinished', (event) =>
          onFinished(event, 'existing', existingOffscreen.send),
        ),
      ]
    : [];
  if (existingOffscreen) confirmedSessions.add('existing');

  return {
    arm(label) {
      armedLabel = label;
    },
    snapshot() {
      return [...requests.values()]
        .filter((entry) => confirmedSessions.has(entry.sessionId))
        .map((entry) => ({ ...entry.record }));
    },
    async diagnostics() {
      let inventory;
      try {
        const { targetInfos } = await browserSession.send('Target.getTargets');
        inventory = (targetInfos ?? []).map((target) => ({
          identity: classifyUrl(target.url),
          auto_attached_by_observer: sessionsByTarget.has(target.targetId),
          type: [
            'page',
            'other',
            'service_worker',
            'shared_worker',
            'tab',
            'browser',
            'iframe',
          ].includes(target.type)
            ? target.type
            : 'other_type',
        }));
      } catch {
        inventory = 'unavailable';
      }
      return {
        mode: existingOffscreen ? 'existing' : 'auto_attach',
        counters: { ...counters },
        provisional_sessions: candidateSessions.size,
        confirmed_sessions: confirmedSessions.size,
        buffered_requests: requests.size,
        observer_failure: observerFailure,
        target_inventory: inventory,
      };
    },
    async settle() {
      await Promise.all([...pendingCodes]);
      assert.equal(observerFailure, null, observerFailure ?? 'guest_transport_observer_healthy');
    },
    async stop() {
      armedLabel = null;
      let cleanupFailure = false;
      await Promise.allSettled([...targetTasks]);
      // Resume all targets before disabling discovery, including unrelated ones.
      for (const sessionId of [...pausedSessions]) {
        try {
          await browserSession.send('Runtime.runIfWaitingForDebugger', {}, sessionId);
          pausedSessions.delete(sessionId);
        } catch {
          cleanupFailure = true;
        }
      }
      if (autoAttach) {
        try {
          await browserSession.send('Target.setAutoAttach', {
            autoAttach: false,
            waitForDebuggerOnStart: false,
            flatten: true,
          });
        } catch {
          cleanupFailure = true;
        }
      }
      for (const stop of existingStops) stop();
      browserSession.off('Network.requestWillBeSent', onRequest);
      browserSession.off('Network.responseReceived', onResponse);
      browserSession.off('Network.loadingFinished', onFinished);
      browserSession.off('Target.attachedToTarget', onAttached);
      browserSession.off('Target.targetInfoChanged', onTargetInfoChanged);
      await Promise.all([...pendingCodes]);
      try {
        await existingOffscreen?.detachVerified();
      } catch {
        cleanupFailure = true;
      }
      assert.equal(observerFailure, null, observerFailure ?? 'guest_transport_observer_healthy');
      assert.equal(cleanupFailure, false, 'guest_transport_observer_cleanup_failed');
    },
  };
}

export function requireGuestTransport(requests, attempt) {
  assert.ok(
    requests.some((request) => request.attempt === attempt && request.status !== null),
    `${attempt}_guest_ai_transport_unobserved`,
  );
}
