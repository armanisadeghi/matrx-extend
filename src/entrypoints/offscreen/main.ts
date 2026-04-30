/**
 * Offscreen document entry. Holds long-running fetch streams and Supabase
 * Realtime websockets. Receives stream:start / stream:cancel from SW,
 * re-emits stream:chunk to the requesting tab/sidepanel via webext-bridge.
 */

import { streamFetch } from '@/lib/api/stream';
import { CHANNELS } from '@/lib/messaging/schemas';
import { onMessage, sendMessage } from 'webext-bridge/window';

const inflight = new Map<string, AbortController>();

onMessage(CHANNELS.STREAM_START as never, async (msg: { data: unknown }) => {
  const args = msg.data as {
    runId: string;
    endpoint: string;
    body?: unknown;
    parser: 'text-chunks' | 'rich-events';
  };
  const ctrl = new AbortController();
  inflight.set(args.runId, ctrl);
  try {
    await streamFetch({
      endpoint: args.endpoint,
      body: args.body,
      parser: args.parser,
      signal: ctrl.signal,
      onEvent: (e) => {
        const type =
          e.type === 'text'
            ? 'text'
            : e.type === 'event'
              ? 'event'
              : e.type === 'error'
                ? 'error'
                : 'done';
        const payload =
          e.type === 'text'
            ? { content: e.content }
            : e.type === 'event'
              ? { event: e.event }
              : e.type === 'error'
                ? { message: e.message }
                : {};
        void sendMessage(
          CHANNELS.STREAM_CHUNK as never,
          { runId: args.runId, type, payload } as never,
          'background' as never,
        );
      },
    });
  } finally {
    inflight.delete(args.runId);
  }
  return { ok: true } as never;
});

onMessage(CHANNELS.STREAM_CANCEL as never, (msg: { data: unknown }) => {
  const { runId } = msg.data as { runId: string };
  const ctrl = inflight.get(runId);
  if (ctrl) {
    ctrl.abort();
    inflight.delete(runId);
  }
  return { cancelled: !!ctrl } as never;
});

console.log('[matrx-extend] offscreen ready');
