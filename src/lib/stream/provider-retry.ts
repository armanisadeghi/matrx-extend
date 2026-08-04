/**
 * `provider_retry` — the upstream LLM provider failed and the server is retrying.
 *
 * This event changes a load-bearing assumption. Before it existed, silence on the
 * stream meant something was wrong. Now the server can go DELIBERATELY quiet for
 * the retry backoff (`retry_delay`, easily longer than the 75s stall threshold)
 * and then resume as if nothing happened. Two things follow:
 *
 *  1. The stall watchdog must be HELD across the backoff, or it declares a
 *     perfectly healthy run dead and shows the user a false "connection lost".
 *     That is a regression the event exists to prevent — see `deadlineFor()`.
 *
 *  2. The user should be told. A 30-second unexplained pause reads as a hang;
 *     "Anthropic is rate-limiting — retrying in 12s (attempt 2 of 5)" reads as
 *     the system working. The server ships a ready-made `user_message` for this.
 *
 * States (from the backend contract):
 *   scheduled     — a retry is queued; the stream will be silent until `retry_at`
 *   retrying_now  — the retry is being attempted right now
 *   recovered     — the retry succeeded; the stream is live again
 *   cancelled     — the retry was abandoned
 *   suspended     — retrying is paused (e.g. awaiting user action)
 *
 * This module is pure so it can be unit-tested without a stream.
 */

import type { ProviderRetryPayload } from '@gen/stream-events';

/** A retry the UI should surface. `null` means "nothing to show". */
export interface ProviderRetryState {
  state: ProviderRetryPayload['state'];
  /** Human-facing copy, supplied by the server. Never invent our own. */
  userMessage: string;
  provider: string;
  errorType: string;
  failedAttempt: number;
  maxRetries: number;
  /** Epoch ms the retry is expected to fire, when the server told us. */
  retryAtMs: number | null;
  canCancel: boolean;
  canRetryNow: boolean;
}

/** States where the stream is expected to be SILENT but is still alive. */
const QUIET_STATES: ReadonlySet<ProviderRetryPayload['state']> = new Set([
  'scheduled',
  'suspended',
]);

/** States that mean the retry episode is over — clear any banner. */
const TERMINAL_STATES: ReadonlySet<ProviderRetryPayload['state']> = new Set([
  'recovered',
  'cancelled',
]);

/**
 * Narrow an untyped stream event payload into a ProviderRetryPayload.
 * Defensive: the deployed backend schema can lead the generated types.
 */
export function parseProviderRetry(data: unknown): ProviderRetryPayload | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const state = d.state;
  if (
    state !== 'scheduled' &&
    state !== 'retrying_now' &&
    state !== 'cancelled' &&
    state !== 'suspended' &&
    state !== 'recovered'
  ) {
    return null;
  }
  return d as unknown as ProviderRetryPayload;
}

/** Is the retry over (so the UI should stop showing it)? */
export function isTerminal(p: ProviderRetryPayload): boolean {
  return TERMINAL_STATES.has(p.state);
}

/**
 * When should the watchdog next expect a sign of life, in epoch ms?
 *
 * `null` means "no special hold — treat this event as an ordinary heartbeat".
 * We only hold for states where silence is EXPECTED; `retrying_now` means the
 * request is already in flight, so normal stall rules should resume.
 *
 * The server may express the deadline either as an absolute `retry_at` or a
 * relative `retry_delay` (seconds). Prefer the absolute one; fall back to the
 * delay. Both are optional, so a scheduled retry with neither gets no hold —
 * better to risk an early stall than to hang forever on a missing field.
 */
export function deadlineFor(p: ProviderRetryPayload, nowMs: number = Date.now()): number | null {
  if (!QUIET_STATES.has(p.state)) return null;

  // `retry_at` is a unix timestamp. Backends differ on seconds vs ms; disambiguate
  // by magnitude rather than trusting a convention (a seconds value read as ms
  // lands in 1970 and would silently produce no hold at all).
  if (typeof p.retry_at === 'number' && p.retry_at > 0) {
    const ms = p.retry_at < 1e12 ? p.retry_at * 1000 : p.retry_at;
    if (ms > nowMs) return ms;
  }
  if (typeof p.retry_delay === 'number' && p.retry_delay > 0) {
    return nowMs + p.retry_delay * 1000;
  }
  return null;
}

/** Project the wire payload into the shape the UI renders. */
export function toRetryState(
  p: ProviderRetryPayload,
  nowMs: number = Date.now(),
): ProviderRetryState {
  return {
    state: p.state,
    userMessage: p.user_message || p.message || 'The AI provider had a problem. Retrying…',
    provider: p.provider,
    errorType: p.error_type,
    failedAttempt: p.failed_attempt,
    maxRetries: p.max_retries,
    retryAtMs: deadlineFor(p, nowMs),
    canCancel: p.can_cancel === true,
    canRetryNow: p.can_retry_now === true,
  };
}
