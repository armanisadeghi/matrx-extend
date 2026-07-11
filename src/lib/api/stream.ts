/**
 * NDJSON stream consumer.
 *
 * Wire format (per Matrx FastAPI backend, mirrors lib/api/stream-parser.ts in
 * matrx-frontend):
 *   - Each event is a JSON object on its own line, separated by `\n`
 *   - Compact events use `{ e: "c", t: "..." }` for chunks /
 *     `{ e: "r", t: "..." }` for reasoning chunks
 *   - Standard events use `{ event: "<name>", data: { ... } }`
 *   - Both are normalized via expandCompactEvent before downstream handling
 *
 * Every raw line is logged so the user can see exactly what came back.
 */

import { log } from '@/lib/debug/log';
import {
  type TypedStreamEvent,
  expandCompactEvent,
  isChunkEvent,
  isCompactEvent,
  isEndEvent,
  isErrorEvent,
  isReasoningChunkEvent,
} from '@gen/stream-events';

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
    res = await fetch(opts.url, {
      method: 'POST',
      headers: opts.headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
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

  const reader = res.body?.getReader();
  if (!reader) {
    log.error('stream', 'no response body reader');
    opts.onEvent({ type: 'error', message: 'No response body' });
    opts.onEvent({ type: 'done' });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let lineCount = 0;
  let parsedCount = 0;

  const handleLine = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    lineCount++;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      log.warn('stream', `unparseable line #${lineCount}`, {
        raw: trimmed.slice(0, 500),
        error: (err as Error).message,
      });
      return;
    }

    // Log the raw event before any normalization so the user sees the wire.
    // Tag with the wire event type so the Debug tab can filter by it — this
    // is the one log site that sees EVERY event (incl. tool_event /
    // resource_changed, which the chat hooks consume without logging).
    const rawTag =
      parsed && typeof parsed === 'object' && 'event' in parsed
        ? String((parsed as Record<string, unknown>).event)
        : undefined;
    log.info('stream', `raw event #${lineCount}`, parsed, rawTag);

    let event: TypedStreamEvent;
    try {
      event = isCompactEvent(parsed) ? expandCompactEvent(parsed) : (parsed as TypedStreamEvent);
    } catch (err) {
      log.warn('stream', `failed to normalize line #${lineCount}`, err);
      return;
    }

    parsedCount++;
    dispatch(event, opts.onEvent);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }
    // Flush pending UTF-8 + any trailing partial line (server may not send a
    // final newline before closing).
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
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

function dispatch(event: TypedStreamEvent, onEvent: (e: StreamEvent) => void): void {
  if (isChunkEvent(event)) {
    onEvent({ type: 'text', content: event.data.text });
    return;
  }
  if (isReasoningChunkEvent(event)) {
    onEvent({ type: 'reasoning', content: event.data.text });
    return;
  }
  if (isErrorEvent(event)) {
    const data = event.data;
    onEvent({
      type: 'error',
      message: data.user_message ?? data.message ?? 'unknown error',
    });
    return;
  }
  if (isEndEvent(event)) {
    onEvent({
      type: 'event',
      eventName: 'end',
      data: (event.data ?? {}) as Record<string, unknown>,
    });
    return;
  }
  // Phase / completion / tool_event / data / heartbeat / etc — pass through.
  onEvent({
    type: 'event',
    eventName: event.event,
    data: ((event as { data?: unknown }).data ?? {}) as Record<string, unknown>,
  });
}
