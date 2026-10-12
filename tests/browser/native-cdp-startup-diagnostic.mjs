import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { request } from 'node:http';

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

export async function observeNativeCdpStartup(
  options,
  connect,
  {
    enabled = process.env.MATRX_CDP_STARTUP_DIAGNOSTIC === '1',
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
    stopProbe?.();
    try {
      emit({
        schema: 1,
        outcome,
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
