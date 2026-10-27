import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';

// Independent handshake only after the real connector has verified ownership.
// No URL, port, path, headers, response body or exception text leaves this helper.
function probeHandshake(url, mark) {
  const endpoint = new URL(url);
  const probe = request({
    hostname: '127.0.0.1',
    port: endpoint.port,
    path: endpoint.pathname,
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
    },
  });
  probe.on('socket', (socket) => socket.once('connect', () => mark('probe_tcp_connected')));
  probe.once('upgrade', (response, socket) => {
    mark('probe_http_status', response.statusCode);
    socket.destroy();
  });
  probe.once('response', (response) => {
    mark('probe_http_status', response.statusCode);
    response.destroy();
  });
  probe.once('error', () => mark('probe_error'));
  probe.end();
  return () => probe.destroy();
}

// A shape-only bounded snapshot shared by connected-path diagnostics and a
// failure-only caller. A late noncancelable readlink cannot mutate the result.
export async function observeNativeStartupBoundary(options, budgetMs) {
  const fileSystem = options.fileSystem ?? fs;
  const unavailable = {
    profileLock: 'unavailable',
    childExitObserved: null,
    stderrClosed: null,
    stderrReadableEnded: null,
  };
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return unavailable;
  const snapshot = async () => {
    const child = options.startupChild;
    let profileLock = 'unavailable';
    try {
      const lock = await fileSystem.readlink(
        join(options.preparedProfile.profile, 'SingletonLock'),
      );
      const owner = /-(\d+)$/.exec(lock)?.[1];
      profileLock = !owner
        ? 'malformed'
        : !Number.isSafeInteger(child?.pid)
          ? 'owner_uncompared'
          : Number(owner) === child.pid
            ? 'spawned_child'
            : 'other_owner';
    } catch (error) {
      if (error?.code === 'ENOENT') profileLock = 'absent';
    }
    return {
      profileLock,
      childExitObserved: child ? child.exitCode !== null || child.signalCode !== null : null,
      stderrClosed: typeof child?.stderr?.destroyed === 'boolean' ? child.stderr.destroyed : null,
      stderrReadableEnded:
        typeof child?.stderr?.readableEnded === 'boolean' ? child.stderr.readableEnded : null,
    };
  };
  let timer;
  try {
    return await Promise.race([
      snapshot(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(unavailable), budgetMs);
      }),
    ]);
  } catch {
    return unavailable;
  } finally {
    clearTimeout(timer);
  }
}

export async function observeNativeCdpStartup(
  options,
  connect,
  {
    enabled = process.env.MATRX_CDP_STARTUP_DIAGNOSTIC === '1' ||
      process.env.MATRX_STARTUP_INTERVAL_DIAGNOSTIC === '1',
    emit = (value) =>
      process.stderr.write(`BROWSER_CDP_STARTUP_INTERVAL ${JSON.stringify(value)}\n`),
  } = {},
) {
  if (!enabled) return connect(options);
  const started = performance.now();
  const phases = [];
  let finished = false;
  const mark = (phase, status) => {
    if (finished) return;
    phases.push({
      phase,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
    });
  };
  let longestTimerDelayMs = 0;
  let timerSamples = 0;
  const cadenceMs = Math.max(1, Math.floor(options.startupDeadlineMs / 50));
  let expectedTick = performance.now() + cadenceMs;
  const timer = setInterval(() => {
    timerSamples++;
    longestTimerDelayMs = Math.max(longestTimerDelayMs, performance.now() - expectedTick);
    expectedTick = performance.now() + cadenceMs;
  }, cadenceMs);
  const fileSystem = options.fileSystem ?? fs;
  const WebSocketCtor = options.WebSocketCtor ?? globalThis.WebSocket;
  const boundedBoundary = () => observeNativeStartupBoundary(options, cadenceMs);
  // Start alongside the connector: diagnostic I/O cannot delay its deadline.
  let observedInitialBoundary = null;
  const initialBoundaryPending = boundedBoundary().then((value) => {
    observedInitialBoundary = value;
    return value;
  });
  let stopProbe;
  let outcome = 'failed';
  try {
    const result = await connect({
      ...options,
      fileSystem: {
        ...fileSystem,
        async readFile(...args) {
          try {
            const result = await fileSystem.readFile(...args);
            mark('endpoint_read');
            return result;
          } catch (error) {
            // Missing endpoint polls are summarized by the connector on timeout.
            if (error?.code !== 'ENOENT') mark('endpoint_read_failed');
            throw error;
          }
        },
        async readlink(...args) {
          mark('owner_check_started');
          return fileSystem.readlink(...args);
        },
      },
      WebSocketCtor: class extends WebSocketCtor {
        constructor(url) {
          mark('owner_verified');
          super(url);
          mark('socket_constructed');
          this.addEventListener('open', () => mark('socket_open'), { once: true });
          this.addEventListener('error', () => mark('socket_error'), { once: true });
          this.addEventListener('close', () => mark('socket_closed'), { once: true });
          const close = this.close;
          this.close = function (...args) {
            mark('socket_close_requested');
            return close.apply(this, args);
          };
          try {
            stopProbe = probeHandshake(url, mark);
          } catch {
            mark('probe_unavailable');
          }
        }
      },
    });
    outcome = 'connected';
    return result;
  } finally {
    longestTimerDelayMs = Math.max(longestTimerDelayMs, performance.now() - expectedTick);
    mark('connector_settled');
    clearInterval(timer);
    finished = true;
    // Success returns immediately; no diagnostic filesystem wait belongs on its
    // critical path. Failure retains bounded snapshots and the original error.
    const [initialBoundary, finalBoundary] =
      outcome === 'connected'
        ? [observedInitialBoundary, null]
        : await Promise.all([initialBoundaryPending, boundedBoundary()]);
    stopProbe?.();
    try {
      emit({
        schema: 1,
        outcome,
        initialStartupBoundary: initialBoundary,
        startupBoundary: finalBoundary,
        phases,
        longestTimerDelayMs: Math.max(0, Math.round(longestTimerDelayMs)),
        timerSamples,
        verdict: 'DIAGNOSTIC_ONLY_NO_PRODUCT_ACCEPTANCE',
      });
    } catch {
      /* Diagnostic sink never replaces the connector's result/error. */
    }
  }
}

// One bounded observation contract for hosted and Notes diagnostic sinks.
// Unknown is distinct from an actual lstat result and validated connector record.
export function safeEndpointObservation(value) {
  const count = (n) => Number.isSafeInteger(n) && n >= 0;
  const fail = () => {
    throw new Error('endpoint_observation_shape_refused');
  };
  if (!['cdp_connected', 'cdp_timeout', 'post_timeout'].includes(value?.phase)) fail();
  if (value.endpointPresent !== null && typeof value.endpointPresent !== 'boolean') fail();
  if (!['unobserved', 'lstat', 'validated_connector_record'].includes(value.presenceBasis)) fail();
  if ((value.endpointPresent === null) !== (value.presenceBasis === 'unobserved')) fail();
  if (
    value.presenceBasis === 'validated_connector_record' &&
    (value.endpointPresent !== true || value.phase !== 'cdp_connected')
  )
    fail();
  if (value.phase === 'cdp_timeout' && value.presenceBasis !== 'unobserved') fail();
  if (value.phase === 'cdp_connected' && value.presenceBasis !== 'validated_connector_record')
    fail();
  if (value.inspectionFailed && (value.endpointPresent !== null || value.phase !== 'post_timeout'))
    fail();
  for (const key of ['inspectionFailed', 'exitObserved'])
    if (typeof value[key] !== 'boolean') fail();
  for (const key of ['elapsedMs', 'polls']) if (!count(value[key])) fail();
  const timing = (input, origin) => {
    if (
      !input ||
      input.origin !== origin ||
      !count(input.startedElapsedMs) ||
      !count(input.completedElapsedMs) ||
      input.completedElapsedMs < input.startedElapsedMs
    )
      fail();
    return {
      startedElapsedMs: input.startedElapsedMs,
      completedElapsedMs: input.completedElapsedMs,
      origin,
    };
  };
  const sampleTiming =
    value.sampleTiming === null ? null : timing(value.sampleTiming, 'post_timeout_observer');
  if ((value.presenceBasis === 'lstat') !== (sampleTiming !== null)) fail();
  if (sampleTiming && sampleTiming.completedElapsedMs > value.elapsedMs) fail();
  const inspection = value.recordInspection;
  if (
    ![
      'validated_owned_record',
      'missing',
      'record_refused',
      'owner_refused',
      'inspection_failed',
      'budget_expired',
      'not_attempted',
    ].includes(inspection?.outcome)
  )
    fail();
  const inspectionTiming =
    inspection.timing === null ? null : timing(inspection.timing, 'post_timeout_observer');
  if ((inspection.outcome === 'not_attempted') !== (inspectionTiming === null)) fail();
  if (inspectionTiming && inspectionTiming.completedElapsedMs > value.elapsedMs) fail();
  if (inspection.outcome === 'validated_owned_record' && value.endpointPresent !== true) fail();
  const safe = {
    phase: value.phase,
    endpointPresent: value.endpointPresent,
    presenceBasis: value.presenceBasis,
    sampleTiming,
    recordInspection: { outcome: inspection.outcome, timing: inspectionTiming },
    inspectionFailed: value.inspectionFailed,
    exitObserved: value.exitObserved,
    elapsedMs: value.elapsedMs,
    polls: value.polls,
  };
  if (value.phase !== 'post_timeout') {
    if (!count(value.reportedElapsedMs) || value.reportedElapsedMs < value.elapsedMs) fail();
    safe.reportedElapsedMs = value.reportedElapsedMs;
  }
  if (value.phase === 'cdp_timeout') {
    if (
      !count(value.failureObservedElapsedMs) ||
      value.failureObservedElapsedMs !== value.elapsedMs
    )
      fail();
    safe.failureObservedElapsedMs = value.failureObservedElapsedMs;
  }
  return safe;
}
