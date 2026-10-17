import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const CHAT_PATH = '/ai/mandates/extend.browser_chat';
const VERSIONED_CHAT_PATH = `/v2${CHAT_PATH}`;
const API_PREFIX = '/api';
const conversationFingerprint = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

export function guestTransportModeForReceipt(receipt) {
  const refuse = () => {
    throw new Error('guest_transport_receipt_unrecognized');
  };
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (
    typeof receipt?.version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(receipt.version) ||
    !hash(receipt.treeSha256)
  )
    refuse();
  const { kind, version } = receipt;
  // Authentication and byte verification belong to the hosted artifact loader
  // and native harness. Require their provenance shape here, never infer trust
  // from a version alone. Transport capability changed once at .520.
  if (kind === 'native_store_zip_candidate_key_adapted') {
    const selected = receipt.artifactSelection;
    if (
      receipt.publishState !== 'pushed' ||
      typeof receipt.sourceSha !== 'string' ||
      !/^[a-f0-9]{40}$/.test(receipt.sourceSha) ||
      selected?.source !== 'release_receipt_store_zip' ||
      !hash(receipt.storeZip?.sha256) ||
      selected.selectedZipSha256 !== receipt.storeZip.sha256 ||
      !hash(selected.publisherSourceTreeSha256) ||
      !hash(receipt.storeTreeSha256) ||
      selected.originalStoreTreeSha256 !== receipt.storeTreeSha256 ||
      selected.runtimeTreeSha256 !== receipt.treeSha256 ||
      !Array.isArray(selected.modifiedPaths) ||
      selected.modifiedPaths.length !== 1 ||
      selected.modifiedPaths[0] !== 'manifest.json'
    )
      refuse();
  } else if (kind === 'published_store_crx_unpacked') {
    if (
      !hash(receipt.crxSha256) ||
      typeof receipt.extensionId !== 'string' ||
      !/^[a-p]{32}$/.test(receipt.extensionId) ||
      receipt.downloadSource !==
        'Google Chrome public update service; verified CRX3 signing key and SHA-256'
    )
      refuse();
  } else if (kind === 'local_dev_unpacked') {
    if (
      receipt.schema_version !== 1 ||
      receipt.publish_state !== 'not_published' ||
      typeof receipt.extensionDir !== 'string' ||
      !receipt.extensionDir ||
      typeof receipt.observedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(receipt.observedAt) ||
      !Number.isFinite(Date.parse(receipt.observedAt))
    )
      refuse();
  } else refuse();
  if (version === '0.2.205' && kind !== 'local_dev_unpacked') return 'legacy';
  const [major, minor, patch] = version.split('.').map(Number);
  if (
    [major, minor, patch].every(Number.isSafeInteger) &&
    (major > 0 || minor > 2 || (minor === 2 && patch >= 520))
  )
    return 'package';
  return refuse();
}

function chatPathClass(url) {
  const pathname = new URL(url).pathname;
  if ([VERSIONED_CHAT_PATH, `${API_PREFIX}${VERSIONED_CHAT_PATH}`].includes(pathname)) {
    return 'versioned';
  }
  if ([CHAT_PATH, `${API_PREFIX}${CHAT_PATH}`].includes(pathname)) return 'canonical';
  return null;
}

function safeConversationRequest(postData) {
  try {
    const body = JSON.parse(postData);
    return {
      conversation_fingerprint:
        typeof body.conversation_id === 'string' && body.conversation_id.length > 0
          ? conversationFingerprint(body.conversation_id)
          : null,
      is_new: typeof body.is_new === 'boolean' ? body.is_new : null,
    };
  } catch {
    return { conversation_fingerprint: null, is_new: null };
  }
}

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

function streamTerminal(body, base64Encoded) {
  const decoded = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
  let terminal = false;
  let error = false;
  for (const line of decoded.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      error = true;
      continue;
    }
    const kind = payload?.event;
    const detail = payload?.data ?? payload;
    if (
      kind === 'error' ||
      (kind === 'completion' &&
        detail?.operation === 'user_request' &&
        detail?.status !== 'success') ||
      (kind === 'record_update' &&
        /(?:^|\.)user_request$/.test(String(detail?.table ?? '')) &&
        ['failed', 'cancelled'].includes(detail?.status)) ||
      (kind === 'end' && ['error', 'failed', 'cancelled'].includes(detail?.reason))
    )
      error = true;
    if (kind === 'end' && detail?.reason === 'complete') terminal = true;
  }
  return { terminal, error };
}

export async function watchGuestAiRequests({
  browserSession,
  attachOffscreen,
  panelTarget,
  panel,
  mode = 'legacy',
}) {
  const offscreenUrl = new URL('offscreen.html', panelTarget.url).href;
  const requests = new Map();
  const pendingCodes = new Set();
  const pendingBodies = new Set();
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

  const onRequest = (
    { requestId, request },
    sessionId,
    send = (method, params) => browserSession.send(method, params, sessionId),
  ) => {
    counters.request_events++;
    if (request?.method === 'POST') counters.post_events++;
    try {
      if (chatPathClass(request?.url)) counters.chat_path_events++;
    } catch {}
    if (
      (!confirmedSessions.has(sessionId) && !candidateSessions.has(sessionId)) ||
      !armedLabel ||
      request?.method !== 'POST'
    )
      return;
    try {
      if (!chatPathClass(request.url)) return;
      const entry = {
        sessionId,
        record: {
          attempt: armedLabel,
          request_at_utc: new Date().toISOString(),
          cdp_request_id: requestId,
          status: null,
          code: null,
          ...(mode === 'package' && {
            terminal_success: false,
            stream_error: false,
            loading_finished: false,
          }),
          path_class: chatPathClass(request.url),
          ...safeConversationRequest(request.postData),
        },
      };
      requests.set(`${sessionId}:${requestId}`, entry);
      if (typeof request.postData !== 'string') {
        const pending = send('Network.getRequestPostData', { requestId })
          .then(({ postData }) => {
            Object.assign(entry.record, safeConversationRequest(postData));
          })
          .catch(() => {});
        pendingBodies.add(pending);
        void pending.finally(() => pendingBodies.delete(pending));
      }
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
    if (!request) return;
    if (mode === 'legacy' && (request.status === null || request.status < 400)) return;
    if (mode === 'package') request.loading_finished = true;
    const pending = send('Network.getResponseBody', { requestId })
      .then(({ body, base64Encoded }) => {
        if (request.status !== null && request.status >= 400) {
          request.code = structuredErrorCode(body, base64Encoded);
        } else {
          const terminal = streamTerminal(body, base64Encoded);
          request.terminal_success = terminal.terminal;
          request.stream_error = terminal.error;
        }
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

  if (mode === 'package') {
    assert.ok(panel, 'package_guest_panel_session_required');
    await panel.send('Network.enable');
    counters.network_enabled++;
    confirmedSessions.add('panel');
    const stops = [
      panel.on('Network.requestWillBeSent', (event) => onRequest(event, 'panel', panel.send)),
      panel.on('Network.responseReceived', (event) => onResponse(event, 'panel')),
      panel.on('Network.loadingFinished', (event) => onFinished(event, 'panel', panel.send)),
    ];
    return {
      arm(label) {
        armedLabel = label;
      },
      snapshot() {
        return [...requests.values()].map((entry) => ({ ...entry.record }));
      },
      async diagnostics() {
        return { mode: 'panel', counters: { ...counters }, buffered_requests: requests.size };
      },
      async settle() {
        await Promise.all([...pendingCodes, ...pendingBodies]);
      },
      async stop() {
        armedLabel = null;
        for (const stop of stops) stop();
        await Promise.all([...pendingCodes, ...pendingBodies]);
      },
    };
  }
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
        existingOffscreen.on('Network.requestWillBeSent', (event) =>
          onRequest(event, 'existing', existingOffscreen.send),
        ),
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
      await Promise.all([...pendingCodes, ...pendingBodies]);
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
      await Promise.all([...pendingCodes, ...pendingBodies]);
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

export function requireGuestTransport(requests, attempt, mode = 'legacy') {
  assert.ok(
    requests.some(
      (request) =>
        request.attempt === attempt &&
        (mode === 'package'
          ? request.status === 200 &&
            request.loading_finished === true &&
            request.terminal_success === true &&
            request.stream_error === false
          : request.status !== null),
    ),
    `${attempt}_guest_ai_transport_unobserved`,
  );
}

export function requireGuestConversationSequence(requests) {
  const successfulRoute = (attempt) => {
    const rows = requests.filter((request) => request.attempt === attempt);
    if (rows.length === 1) {
      assert.equal(rows[0].status, 200, `${attempt}_requires_http_200`);
      assert.ok(
        ['canonical', 'versioned'].includes(rows[0].path_class),
        `${attempt}_requires_known_chat_route`,
      );
      assert.ok(rows[0].conversation_fingerprint, `${attempt}_conversation_identity_unobserved`);
      return rows[0];
    }

    assert.equal(rows.length, 2, `${attempt}_requires_one_success_or_v2_fallback`);
    const [fallback, canonical] = rows;
    assert.ok(
      fallback.path_class === 'versioned' && [404, 405].includes(fallback.status),
      `${attempt}_fallback_must_be_v2_not_found_or_method_not_allowed`,
    );
    assert.equal(canonical.path_class, 'canonical', `${attempt}_fallback_must_use_canonical_route`);
    assert.equal(canonical.status, 200, `${attempt}_canonical_fallback_requires_http_200`);
    assert.equal(
      canonical.conversation_fingerprint,
      fallback.conversation_fingerprint,
      `${attempt}_fallback_must_keep_conversation_identity`,
    );
    assert.equal(canonical.is_new, fallback.is_new, `${attempt}_fallback_must_keep_is_new`);
    assert.ok(canonical.conversation_fingerprint, `${attempt}_conversation_identity_unobserved`);
    return canonical;
  };
  const opening = successfulRoute('opening');
  const same = successfulRoute('same_conversation_followup');
  const reloaded = successfulRoute('post_reload_new_conversation');
  assert.equal(opening.is_new, true, 'opening_must_start_new_conversation');
  assert.equal(same.is_new, false, 'followup_must_continue_conversation');
  assert.equal(
    same.conversation_fingerprint,
    opening.conversation_fingerprint,
    'followup_must_keep_opening_conversation_identity',
  );
  assert.equal(reloaded.is_new, true, 'post_reload_must_start_new_conversation');
  assert.notEqual(
    reloaded.conversation_fingerprint,
    opening.conversation_fingerprint,
    'post_reload_must_use_new_conversation_identity',
  );
}
