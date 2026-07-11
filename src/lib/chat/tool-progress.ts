/**
 * Normalize a `tool_progress` SSE sub-event into a stored {@link ToolProgressEntry}.
 *
 * The server is liberal about where it puts the human-readable line — it may
 * arrive as the top-level `tool_event.message`, or inside the nested `data`
 * payload as `label` / `message` / `status`. We coalesce them so a handler on
 * either side doesn't have to agree on one exact key. Everything is optional;
 * an empty update still records arrival time (useful as a heartbeat that the
 * tool is alive).
 */

import type { ToolProgressEntry } from '@/state/chat';

function asStatus(v: unknown): ToolProgressEntry['status'] | undefined {
  return v === 'pending' || v === 'active' || v === 'done' || v === 'error' ? v : undefined;
}

/**
 * @param topMessage the `tool_event.message` field (server's friendly line)
 * @param inner      the nested `tool_event.data` payload
 */
export function progressFromWire(
  topMessage: string | undefined,
  inner: Record<string, unknown>,
): ToolProgressEntry {
  const label =
    topMessage ??
    (typeof inner.label === 'string' ? inner.label : undefined) ??
    (typeof inner.message === 'string' ? inner.message : undefined) ??
    (typeof inner.status === 'string' ? inner.status : undefined);
  const status = asStatus(inner.status);
  return {
    at: Date.now(),
    ...(label !== undefined ? { label } : {}),
    ...(typeof inner.step === 'string' ? { step: inner.step } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(typeof inner.percent === 'number' ? { percent: inner.percent } : {}),
    // Keep the raw payload for custom renderers, but only when it carries more
    // than the fields we already lifted out — avoids a redundant `data` blob.
    ...(inner.data !== undefined ? { data: inner.data } : {}),
  };
}
