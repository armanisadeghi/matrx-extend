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
 * Stream envelopes can contain delegated Network recipe arguments and captured
 * URLs. Debug records metadata, never raw envelope/body text.
 */

import { sanitizeNetworkUrl } from '@/lib/credentials/network-urls';
import { log } from '@/lib/debug/log';
import {
  fetchWithMatrxProtocolFallback,
  isResumeConflict,
  readLiveRunRejoin,
  readLiveStreamUnavailable,
  streamErrorText,
} from '@ai-matrx/agents/matrx';
import { type MatrxStreamEnvelope, readMatrxNdjsonStream } from '@ai-matrx/agents/stream/ndjson';

/**
 * Protocol classifications of a non-2xx stream open (the decisions are
 * `@ai-matrx/agents/matrx`'s): `run_in_progress` = the run is STILL RUNNING —
 * the caller POSTs the body's rejoin target instead of failing the turn;
 * `resume_conflict` = retried (never rejoined, even when the body names a
 * live run); `live_stream_unavailable` = a rejoin with no journal — the caller
 * follows the run to its end and reloads the saved turn.
 */
export type StreamErrorCode =
  | 'resume_conflict'
  | 'run_in_progress'
  | 'live_stream_unavailable'
  | 'guest_ai_allowance_used';

/** A live run to rejoin, as read from the refusal body by `readLiveRunRejoin`. */
export interface StreamRejoinTarget {
  liveRequestId: string | null;
  rejoinPath: string;
  runId: string | null;
}

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
  | {
      type: 'error';
      /** Safe to show in a chat surface. Never contains the response body. */
      message: string;
      status?: number;
      /** Known refusal classification; never render this as user text. */
      code?: StreamErrorCode;
      /** The live run to rejoin — only with `code: 'run_in_progress'`. */
      rejoin?: StreamRejoinTarget;
      /** Workflow `run_id` a `live_stream_unavailable` answer names (null when none). */
      unavailableRunId?: string | null;
    }
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
  const diagnosticUrl = sanitizeNetworkUrl(opts.url);
  log.info('stream', `→ POST ${diagnosticUrl}`, {
    auth: !!opts.headers.Authorization,
    hasBody: opts.body !== undefined,
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
          log.warn('stream', `ai_v2_downgrade → retrying on v1: ${sanitizeNetworkUrl(url)}`, {
            reason,
            status,
          });
        },
      },
    );
    res = response;
  } catch (err) {
    log.error('stream', `✗ ${diagnosticUrl} network error`, {
      error: err instanceof Error ? err.name : 'NetworkError',
    });
    opts.onEvent({ type: 'error', message: streamErrorMessage(0), status: 0 });
    opts.onEvent({ type: 'done' });
    return;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    // ALWAYS the body's own `rejoin_path` — never a URL built here (some doors
    // name no live request id at all).
    const refusal = { status: res.status, serverDetail: parseJsonBody(errText) };
    const rejoin = readLiveRunRejoin(refusal);
    const unavailable = readLiveStreamUnavailable(refusal);
    const guestAllowanceUsed = isGuestAllowanceUsed(res.status, refusal.serverDetail);
    const code: StreamErrorCode | undefined = guestAllowanceUsed
      ? 'guest_ai_allowance_used'
      : rejoin
        ? 'run_in_progress'
        : unavailable
          ? 'live_stream_unavailable'
          : isResumeConflict(refusal)
            ? 'resume_conflict'
            : undefined;
    log.error('stream', `✗ ${diagnosticUrl} ${res.status}`, {
      code: code ?? 'http_error',
      status: res.status,
    });
    opts.onEvent({
      type: 'error',
      message: guestAllowanceUsed ? GUEST_ALLOWANCE_MESSAGE : streamErrorMessage(res.status),
      status: res.status,
      ...(code !== undefined && { code }),
      ...(rejoin && {
        rejoin: {
          liveRequestId: rejoin.liveRequestId,
          rejoinPath: rejoin.rejoinPath,
          runId: rejoin.runId,
        },
      }),
      ...(unavailable && { unavailableRunId: unavailable.runId }),
    });
    opts.onEvent({ type: 'done' });
    return;
  }
  const requestId = res.headers.get('X-Request-ID');
  const conversationId = res.headers.get('X-Conversation-ID');
  const contentType = res.headers.get('content-type');
  log.success('stream', `← ${diagnosticUrl} ${res.status} stream open`, {
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
      onMalformedLine: ({ error, lineNumber }) => {
        lineCount = Math.max(lineCount, lineNumber);
        log.warn('stream', `unparseable line #${lineNumber}`, {
          error: error instanceof Error ? error.name : 'ParseError',
        });
      },
      onUnknownEnvelope: () => {
        log.warn('stream', 'unknown JSON envelope');
      },
      onValidEnvelope: ({ envelope, lineNumber }) => {
        lineCount = Math.max(lineCount, lineNumber);
        parsedCount++;
        // Keep the event kind for diagnostics. Raw payloads may contain URLs,
        // request bodies, or delegated save arguments with live credentials.
        log.info('stream', `event #${lineNumber}`, { event: envelope.event }, envelope.event);
      },
    })) {
      dispatch(event, opts.onEvent);
    }
  } catch (err) {
    if (opts.signal?.aborted || (err as Error).name === 'AbortError') {
      log.info('stream', 'aborted by client');
    } else {
      log.error('stream', 'read failed', {
        error: err instanceof Error ? err.name : 'StreamError',
      });
      opts.onEvent({ type: 'error', message: streamErrorMessage() });
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
    log.error('stream', 'server emitted an error event');
    const guestAllowanceUsed = isGuestAllowanceUsedEvent(data);
    // A stream `error` event is the server's sentence FOR the person
    // (`user_message`, e.g. "OpenAI refused this request: the platform's
    // OpenAI account is out of credit."). Replacing it with generic copy hid
    // every actionable failure. HTTP error BODIES stay unshown (above).
    onEvent({
      type: 'error',
      message: guestAllowanceUsed
        ? GUEST_ALLOWANCE_MESSAGE
        : (streamErrorText(event) ?? streamErrorMessage()),
      ...(guestAllowanceUsed && { code: 'guest_ai_allowance_used' }),
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

/**
 * HTTP response bodies are diagnostics, not UI copy: validation failures can
 * include the entire rejected request, including page context and secrets.
 */
export function streamErrorMessage(status?: number): string {
  switch (status) {
    case 0:
      return "Couldn't connect to the chat service. Check your connection and try again.";
    case 401:
      return 'Your session has expired. Sign in and try again.';
    case 403:
      return "You don't have access to this chat. Sign in and try again.";
    case 404:
      return 'This chat feature is unavailable. Try again.';
    case 422:
      return 'The chat service could not start this request. Try again.';
    case 429:
      return 'The chat service is busy. Try again shortly.';
    default:
      return status !== undefined && status >= 500
        ? 'The chat service is temporarily unavailable. Try again.'
        : 'The chat service could not complete this request. Try again.';
  }
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const GUEST_ALLOWANCE_MESSAGE = "You've used your free AI tries. Sign up free to keep chatting.";

function isGuestAllowanceUsed(status: number, detail: unknown): boolean {
  return (
    (status === 402 || status === 403) &&
    detail !== null &&
    typeof detail === 'object' &&
    !Array.isArray(detail) &&
    'error' in detail &&
    detail.error === 'guest_ai_allowance_used'
  );
}

function isGuestAllowanceUsedEvent(data: Record<string, unknown>): boolean {
  return data.error_type === 'guest_ai_allowance_used' || data.code === 'guest_ai_allowance_used';
}
