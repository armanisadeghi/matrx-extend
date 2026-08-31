/**
 * NDJSON stream consumer.
 *
 * Wire format (per Matrx FastAPI backend, mirrors lib/api/stream-parser.ts in
 * matrx-frontend):
 *   - Each event is a JSON object on its own line, separated by `\n`
 *   - Compact events use `{ e: "c", t: "..." }` for chunks /
 *     `{ e: "r", t: "..." }` for reasoning chunks
 *   - Standard events use `{ event: "<name>", data: { ... } }`
 *   - Both are normalized by the public `@ai-matrx/agents` wire kernel
 *
 * Every raw line is logged so the user can see exactly what came back.
 */

import { log } from '@/lib/debug/log';
import { fetchWithMatrxProtocolFallback } from '@ai-matrx/agents/matrx';
import { type MatrxStreamEnvelope, readMatrxNdjsonStream } from '@ai-matrx/agents/stream/ndjson';

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'event'; eventName: string; data: Record<string, unknown> }
  /**
   * `status` is the HTTP response status (or 0 for a network error) when the
   * error originated at the request boundary. Undefined for mid-stream errors
   * (parse failures, server-emitted `error` events, abort). Consumers use
   * this to distinguish benign protocol responses — notably resume's 409
   * "outstanding_delegated_calls" — from real failures.
   */
  | { type: 'error'; message: string; status?: number }
  | { type: 'done' };

export interface StreamOpenInfo {
  conversationId: string | null;
  requestId: string | null;
  status: number;
  contentType: string | null;
}

export interface StreamFetchOptions {
  url: string;
  body?: unknown;
  headers: Record<string, string>;
  parser?: 'rich-events';
  signal?: AbortSignal;
  onEvent: (e: StreamEvent) => void;
  /** Fires once, as soon as the SSE response opens with 2xx status. */
  onOpened?: (info: StreamOpenInfo) => void;
}

export async function streamFetch(opts: StreamFetchOptions): Promise<void> {
  log.info('stream', `→ POST ${opts.url}`, {
    auth: !!opts.headers.Authorization,
    body: opts.body,
  });

  let res: Response;
  try {
    // THE v2 → v1 TRANSPORT FALLBACK lives in the package (@ai-matrx/agents
    // 0.6.0, C22), not here. It fires only when a `/v2/ai/...` ENDPOINT itself
    // fails — a non-abort network throw, a 404/405 (surface not on v2), or a
    // 5xx — always BEFORE any stream content is consumed, and never on a user
    // cancel (a cancel logged as a downgrade would poison the exact telemetry
    // the v2 rollout reads). Before this, the extension hardcoded `/v2` with
    // no fallback at all: an unhealthy v2 surface was a hard failure here
    // while the web app degraded and said so.
    //
    // The three options below are PARITY, not taste, and none may be dropped:
    //   - signal goes in the OPTIONS bag, not `init` — resilientFetch drives
    //     its own AbortController and overwrites `init.signal`, so a signal
    //     passed the old way would be silently ignored and cancel would break;
    //   - totalTimeoutMs: null — the shared default is 120_000, which would
    //     guillotine every agent run at two minutes. Streams are uncapped;
    //   - throwOnHttpError: false — this function reports a non-2xx through
    //     its own `onEvent({type:'error', status})` contract (callers branch on
    //     `status`, e.g. resume's benign 409), so the transport must hand the
    //     response back rather than throw.
    const { response } = await fetchWithMatrxProtocolFallback(
      opts.url,
      {
        method: 'POST',
        headers: opts.headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      },
      {
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        totalTimeoutMs: null,
        throwOnHttpError: false,
        onDowngrade: ({ url, reason, status }) => {
          log.warn('stream', `ai_v2_downgrade → retrying on v1: ${url}`, { reason, status });
        },
      },
    );
    res = response;
  } catch (err) {
    log.error('stream', `✗ ${opts.url} network error`, err);
    opts.onEvent({ type: 'error', message: (err as Error).message, status: 0 });
    opts.onEvent({ type: 'done' });
    return;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    log.error('stream', `✗ ${opts.url} ${res.status}`, errText);
    opts.onEvent({ type: 'error', message: `${res.status}: ${errText}`, status: res.status });
    opts.onEvent({ type: 'done' });
    return;
  }
  const requestId = res.headers.get('X-Request-ID');
  const conversationId = res.headers.get('X-Conversation-ID');
  const contentType = res.headers.get('content-type');
  log.success('stream', `← ${opts.url} ${res.status} stream open`, {
    requestId,
    conversationId,
    contentType,
  });
  opts.onOpened?.({ conversationId, requestId, status: res.status, contentType });

  if (!res.body) {
    log.error('stream', 'no response body reader');
    opts.onEvent({ type: 'error', message: 'No response body' });
    opts.onEvent({ type: 'done' });
    return;
  }

  let lineCount = 0;
  let parsedCount = 0;

  try {
    for await (const event of readMatrxNdjsonStream(res.body, {
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      onMalformedLine: ({ line, error, lineNumber }) => {
        lineCount = Math.max(lineCount, lineNumber);
        log.warn('stream', `unparseable line #${lineNumber}`, {
          raw: line.slice(0, 500),
          error: error instanceof Error ? error.message : String(error),
        });
      },
      onUnknownEnvelope: (raw) => {
        log.warn('stream', 'unknown JSON envelope', raw);
      },
      onValidEnvelope: ({ raw, envelope, lineNumber }) => {
        lineCount = Math.max(lineCount, lineNumber);
        parsedCount++;
        // The package owns framing; Extend retains exact wire diagnostics via
        // its explicit raw-observation hook instead of a second JSON parser.
        log.info('stream', `raw event #${lineNumber}`, raw, envelope.event);
      },
    })) {
      dispatch(event, opts.onEvent);
    }
  } catch (err) {
    if (opts.signal?.aborted || (err as Error).name === 'AbortError') {
      log.info('stream', 'aborted by client');
    } else {
      log.error('stream', 'read failed', err);
      opts.onEvent({ type: 'error', message: (err as Error).message });
    }
  } finally {
    log.success('stream', `done (${lineCount} lines, ${parsedCount} events)`);
    opts.onEvent({ type: 'done' });
  }
}

function dispatch(event: MatrxStreamEnvelope, onEvent: (e: StreamEvent) => void): void {
  const data =
    event.data !== null && typeof event.data === 'object' && !Array.isArray(event.data)
      ? (event.data as Record<string, unknown>)
      : {};
  if (event.event === 'chunk' && typeof data.text === 'string') {
    onEvent({ type: 'text', content: data.text });
    return;
  }
  if (event.event === 'reasoning_chunk' && typeof data.text === 'string') {
    onEvent({ type: 'reasoning', content: data.text });
    return;
  }
  if (event.event === 'error') {
    onEvent({
      type: 'error',
      message:
        (typeof data.user_message === 'string' && data.user_message) ||
        (typeof data.message === 'string' && data.message) ||
        'unknown error',
    });
    return;
  }
  if (event.event === 'end') {
    onEvent({
      type: 'event',
      eventName: 'end',
      data,
    });
    return;
  }
  // Phase / completion / tool_event / data / heartbeat / etc — pass through.
  onEvent({
    type: 'event',
    eventName: event.event,
    data,
  });
}
