/**
 * Stream-event wire types + helpers for the Matrx FastAPI NDJSON stream.
 *
 * ⚠️ VENDORED FALLBACK. The canonical version of this file is generated from
 * the aidream backend via `pnpm update-api-types` (which requires the aidream
 * repo cloned at ../aidream). This checked-in copy exists so that a clean
 * checkout of matrx-extend can typecheck (`pnpm compile`), build
 * (`pnpm build`), and run CI without the sibling repo present.
 *
 * It was reconstructed from the documented wire contract in
 * src/lib/api/stream.ts and the exact symbols its two consumers use
 * (src/lib/api/stream.ts, src/hooks/use-chat-stream.ts). If you have aidream
 * checked out, run `pnpm update-api-types` and commit the regenerated file —
 * it supersedes this one.
 *
 * Wire format:
 *   - Compact chunk events:    { e: "c", t: "<text>" }   (assistant text)
 *                              { e: "r", t: "<text>" }   (reasoning text)
 *   - Standard events:         { event: "<name>", data: { ... } }
 *   - `expandCompactEvent` normalizes compact → standard before dispatch.
 */

/** Compact wire chunk — `e` discriminates ("c" = text, "r" = reasoning). */
export interface CompactEvent {
  e: 'c' | 'r';
  t: string;
}

/** Assistant text delta. */
export interface ChunkEvent {
  event: 'chunk';
  data: { text: string };
}

/** Model reasoning delta. */
export interface ReasoningChunkEvent {
  event: 'reasoning_chunk';
  data: { text: string };
}

/** Server-emitted error. `user_message` is the human-facing variant. */
export interface ErrorEvent {
  event: 'error';
  data: { message?: string; user_message?: string; [key: string]: unknown };
}

/** Terminal event for a run. */
export interface EndEvent {
  event: 'end';
  data?: Record<string, unknown>;
}

/**
 * Any other standard event (phase, completion, tool_event, data, heartbeat,
 * resource_changed, info, injection_consumed, …) — passed through to
 * consumers by name.
 */
export interface GenericStreamEvent {
  event: string;
  data?: Record<string, unknown>;
}

export type TypedStreamEvent =
  | ChunkEvent
  | ReasoningChunkEvent
  | ErrorEvent
  | EndEvent
  | GenericStreamEvent;

/**
 * One drained turn-boundary inbox item, echoed inside the
 * `injection_consumed` event's `data.items` array. See
 * docs/TURN_BOUNDARY_INBOX.md and docs/SERVER_NEEDS_turn_boundary_inbox.md.
 */
export interface ConsumedInjection {
  injection_id: string;
  /** Server-echoed message text (self-contained even for items this client never queued). */
  text?: string | null;
  /** False for silent steering items that must not render as a user bubble. */
  is_visible_to_user?: boolean;
  [key: string]: unknown;
}

export function isCompactEvent(value: unknown): value is CompactEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'e' in value &&
    ((value as CompactEvent).e === 'c' || (value as CompactEvent).e === 'r') &&
    typeof (value as CompactEvent).t === 'string'
  );
}

/** Normalize a compact wire event into its standard typed shape. */
export function expandCompactEvent(value: unknown): TypedStreamEvent {
  if (!isCompactEvent(value)) {
    throw new Error('expandCompactEvent: not a compact event');
  }
  return value.e === 'c'
    ? { event: 'chunk', data: { text: value.t } }
    : { event: 'reasoning_chunk', data: { text: value.t } };
}

export function isChunkEvent(event: TypedStreamEvent): event is ChunkEvent {
  return event.event === 'chunk' && typeof (event as ChunkEvent).data?.text === 'string';
}

export function isReasoningChunkEvent(event: TypedStreamEvent): event is ReasoningChunkEvent {
  return (
    event.event === 'reasoning_chunk' &&
    typeof (event as ReasoningChunkEvent).data?.text === 'string'
  );
}

export function isErrorEvent(event: TypedStreamEvent): event is ErrorEvent {
  return event.event === 'error';
}

export function isEndEvent(event: TypedStreamEvent): event is EndEvent {
  return event.event === 'end';
}
