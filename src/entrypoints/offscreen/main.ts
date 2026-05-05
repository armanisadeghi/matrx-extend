/**
 * Offscreen document entry. Listens on STREAM_RUN (NOT STREAM_START — that's
 * sidepanel→SW only). Broadcasts STREAM_CHUNK back to all surfaces.
 *
 * The SW pre-resolves URL + headers before sending us the run, so we never
 * touch chrome.storage or the auth flow here.
 */

import { streamFetch } from '@/lib/api/stream';
import { log, startDebugRelay } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  fetchUrlAndParse,
  type FetchAndParseRequest,
  type FetchAndParseResult,
} from '@/lib/scrape/fetch-and-parse';

startDebugRelay();
log.info('sys', 'offscreen ready');

const inflight = new Map<string, AbortController>();

interface RunArgs {
  runId: string;
  url: string;
  body?: unknown;
  parser?: 'rich-events';
  headers: Record<string, string>;
  /** Optional agent name passed through from the SW for tool log attribution. */
  agentName?: string | null;
  /** Latched permission mode for client tools run during this stream. */
  permissionMode?: 'ask' | 'act';
}

on<RunArgs, { ok: true }>(CHANNELS.STREAM_RUN, async (args) => {
  log.info('stream', `offscreen run ${args.runId} → ${args.url}`);
  const ctrl = new AbortController();
  inflight.set(args.runId, ctrl);
  let chunkCount = 0;
  try {
    await streamFetch({
      url: args.url,
      headers: args.headers,
      body: args.body,
      parser: args.parser,
      signal: ctrl.signal,
      onOpened: (info) => {
        log.info('stream', `opened ${args.runId}`, info);
        broadcast(CHANNELS.STREAM_OPENED, {
          runId: args.runId,
          conversationId: info.conversationId,
          requestId: info.requestId,
          agentName: args.agentName ?? null,
          permissionMode: args.permissionMode ?? 'ask',
        });
      },
      onEvent: (e) => {
        chunkCount++;
        let payload: Record<string, unknown>;
        if (e.type === 'text') payload = { content: e.content };
        else if (e.type === 'reasoning') payload = { content: e.content };
        else if (e.type === 'event') payload = { eventName: e.eventName, data: e.data };
        else if (e.type === 'error') payload = { message: e.message };
        else payload = {};
        if (e.type === 'error') {
          // streamFetch already logged the upstream cause with full detail
          // (network error / 4xx / 5xx body). Don't duplicate that — just
          // record the message inline so the line is searchable, and skip
          // the redundant detail blob that was rendering as [object Object].
          log.warn('stream', `chunk error ${args.runId}: ${e.message ?? '(no message)'}`);
        } else if (e.type === 'done') {
          log.success('stream', `done ${args.runId} (${chunkCount} chunks)`);
        }
        broadcast(CHANNELS.STREAM_CHUNK, { runId: args.runId, type: e.type, payload });
      },
    });
  } catch (err) {
    log.error('stream', `streamFetch threw ${args.runId}`, err);
    broadcast(CHANNELS.STREAM_CHUNK, {
      runId: args.runId,
      type: 'error',
      payload: { message: (err as Error)?.message ?? String(err) },
    });
    broadcast(CHANNELS.STREAM_CHUNK, {
      runId: args.runId,
      type: 'done',
      payload: {},
    });
  } finally {
    inflight.delete(args.runId);
  }
  return { ok: true };
});

// SW asks us to fetch + parse a URL into the standard SoupResult-style
// envelope. Runs in offscreen because it needs DOMParser + the existing
// scrape pipeline.
on<FetchAndParseRequest & { include_extras?: boolean }, FetchAndParseResult>(
  CHANNELS.OFFSCREEN_FETCH_PAGE,
  async (payload) => {
    log.info('stream', `offscreen fetch-page ${payload.url}`);
    const { include_extras, ...req } = payload;
    return fetchUrlAndParse(req, { include_extras });
  },
);

on<{ runId: string }, { cancelled: boolean }>(CHANNELS.STREAM_KILL, (payload) => {
  const ctrl = inflight.get(payload.runId);
  if (ctrl) {
    log.info('stream', `kill ${payload.runId}`);
    ctrl.abort();
    inflight.delete(payload.runId);
  }
  return { cancelled: !!ctrl };
});
