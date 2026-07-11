/**
 * `provider_retry` — the event that makes stream silence AMBIGUOUS.
 *
 * The regression these tests exist to prevent: the stall watchdog fires after 75s
 * of silence, but a scheduled provider retry makes the server go quiet ON PURPOSE
 * for the backoff. Without a hold, a healthy run gets declared dead mid-retry.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ProviderRetryPayload } from '../../types/python-generated/stream-events';
import {
  deadlineFor,
  isTerminal,
  parseProviderRetry,
  toRetryState,
} from '../../src/lib/stream/provider-retry';
import { createStreamWatchdog } from '../../src/lib/stream/watchdog';

const NOW = 1_800_000_000_000; // fixed epoch ms

function payload(over: Partial<ProviderRetryPayload> = {}): ProviderRetryPayload {
  return {
    state: 'scheduled',
    provider: 'anthropic',
    error_type: 'rate_limit',
    message: '429 from provider',
    user_message: 'Anthropic is rate-limiting. Retrying shortly.',
    iteration: 1,
    failed_attempt: 2,
    max_retries: 5,
    ...over,
  } as ProviderRetryPayload;
}

describe('parseProviderRetry', () => {
  it('rejects non-objects and unknown states', () => {
    expect(parseProviderRetry(null)).toBeNull();
    expect(parseProviderRetry('scheduled')).toBeNull();
    expect(parseProviderRetry({ state: 'nonsense' })).toBeNull();
  });

  it('accepts every state in the backend contract', () => {
    for (const s of ['scheduled', 'retrying_now', 'cancelled', 'suspended', 'recovered']) {
      expect(parseProviderRetry({ ...payload(), state: s })?.state).toBe(s);
    }
  });
});

describe('deadlineFor — when is silence expected?', () => {
  it('holds for `scheduled` using the absolute retry_at', () => {
    const at = NOW + 30_000;
    expect(deadlineFor(payload({ retry_at: at }), NOW)).toBe(at);
  });

  it('accepts retry_at in SECONDS as well as ms', () => {
    // A seconds-value naively read as ms lands in 1970 and would silently
    // produce NO hold — the exact bug that would let the watchdog kill the run.
    const seconds = Math.floor((NOW + 30_000) / 1000);
    expect(deadlineFor(payload({ retry_at: seconds }), NOW)).toBe(seconds * 1000);
  });

  it('falls back to the relative retry_delay (seconds)', () => {
    expect(deadlineFor(payload({ retry_delay: 12 }), NOW)).toBe(NOW + 12_000);
  });

  it('prefers retry_at over retry_delay when both are present', () => {
    const at = NOW + 45_000;
    expect(deadlineFor(payload({ retry_at: at, retry_delay: 5 }), NOW)).toBe(at);
  });

  it('does NOT hold for retrying_now — the request is already in flight', () => {
    expect(deadlineFor(payload({ state: 'retrying_now', retry_delay: 30 }), NOW)).toBeNull();
  });

  it('does NOT hold for terminal states', () => {
    expect(deadlineFor(payload({ state: 'recovered', retry_delay: 30 }), NOW)).toBeNull();
    expect(deadlineFor(payload({ state: 'cancelled', retry_delay: 30 }), NOW)).toBeNull();
  });

  it('holds for `suspended` — silence is expected there too', () => {
    expect(deadlineFor(payload({ state: 'suspended', retry_delay: 20 }), NOW)).toBe(NOW + 20_000);
  });

  it('returns null when scheduled but the server gave no timing at all', () => {
    // Better to risk an early stall than to hang forever on a missing field.
    expect(deadlineFor(payload(), NOW)).toBeNull();
  });

  it('ignores a retry_at already in the past', () => {
    expect(deadlineFor(payload({ retry_at: NOW - 10_000 }), NOW)).toBeNull();
  });
});

describe('isTerminal', () => {
  it('is true only for recovered / cancelled', () => {
    expect(isTerminal(payload({ state: 'recovered' }))).toBe(true);
    expect(isTerminal(payload({ state: 'cancelled' }))).toBe(true);
    expect(isTerminal(payload({ state: 'scheduled' }))).toBe(false);
    expect(isTerminal(payload({ state: 'retrying_now' }))).toBe(false);
    expect(isTerminal(payload({ state: 'suspended' }))).toBe(false);
  });
});

describe('toRetryState', () => {
  it("surfaces the SERVER's user_message verbatim", () => {
    expect(toRetryState(payload(), NOW).userMessage).toBe(
      'Anthropic is rate-limiting. Retrying shortly.',
    );
  });

  it('falls back to `message`, then to a generic line', () => {
    expect(toRetryState(payload({ user_message: '' }), NOW).userMessage).toBe('429 from provider');
    expect(toRetryState(payload({ user_message: '', message: '' }), NOW).userMessage).toMatch(
      /Retrying/,
    );
  });
});

describe('watchdog.hold — the actual regression', () => {
  it('does NOT stall during a scheduled retry longer than stallMs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onStall = vi.fn();
    const wd = createStreamWatchdog({ stallMs: 75_000, onStall });
    wd.start();

    // Server: "rate limited, retrying in 120s" — far beyond the 75s stall window.
    const p = payload({ retry_delay: 120 });
    const deadline = deadlineFor(p, Date.now());
    expect(deadline).not.toBeNull();
    if (deadline !== null) wd.hold(deadline);

    // The whole backoff elapses in total silence.
    vi.advanceTimersByTime(120_000);
    expect(onStall).not.toHaveBeenCalled(); // <-- would FAIL without hold()

    // Retry lands and the stream speaks again.
    wd.touch();
    vi.advanceTimersByTime(74_000);
    expect(onStall).not.toHaveBeenCalled();

    wd.stop();
    vi.useRealTimers();
  });

  it('still stalls if the retry never actually arrives', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onStall = vi.fn();
    const wd = createStreamWatchdog({ stallMs: 75_000, onStall });
    wd.start();
    wd.hold(Date.now() + 30_000);

    // Past the retry deadline AND past the grace window: genuinely dead.
    vi.advanceTimersByTime(30_000 + 75_000 + 1_000);
    expect(onStall).toHaveBeenCalledTimes(1);

    wd.stop();
    vi.useRealTimers();
  });

  it('hold never SHORTENS an existing deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onStall = vi.fn();
    const wd = createStreamWatchdog({ stallMs: 75_000, onStall });
    wd.start();

    wd.hold(Date.now() - 60_000); // a stale/past deadline
    vi.advanceTimersByTime(74_000);
    expect(onStall).not.toHaveBeenCalled(); // degrades to a plain touch, not an instant stall

    wd.stop();
    vi.useRealTimers();
  });

  it('hold is a no-op once stopped', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onStall = vi.fn();
    const wd = createStreamWatchdog({ stallMs: 1_000, onStall });
    wd.start();
    wd.stop();
    wd.hold(Date.now() + 10_000);
    vi.advanceTimersByTime(100_000);
    expect(onStall).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
