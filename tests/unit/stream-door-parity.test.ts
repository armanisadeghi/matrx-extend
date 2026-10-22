/**
 * Parity for the stream doors onto @ai-matrx/api (watchdog / provider-retry / resume).
 * Each case fails if a door drops an option or the package changes a behavior the
 * extension relied on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deadlineFor } from '../../src/lib/stream/provider-retry';
import { attemptResume } from '../../src/lib/stream/resume';
import { createStreamWatchdog } from '../../src/lib/stream/watchdog';

describe('watchdog door (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('stalls once after stallMs of silence; touch re-arms', () => {
    const onStall = vi.fn();
    const w = createStreamWatchdog({ stallMs: 1000, onStall });
    w.start();
    vi.advanceTimersByTime(900);
    w.touch();
    vi.advanceTimersByTime(900);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onStall).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(onStall).toHaveBeenCalledTimes(1);
    w.touch(); // no re-arm after stall
    vi.advanceTimersByTime(5000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('hold extends to deadline + stallMs; latest hold wins; stop cancels', () => {
    const onStall = vi.fn();
    const w = createStreamWatchdog({ stallMs: 1000, onStall });
    w.start();
    w.hold(Date.now() + 10_000);
    vi.advanceTimersByTime(10_900);
    expect(onStall).not.toHaveBeenCalled();
    w.hold(Date.now() + 2_000); // earlier, replaces
    vi.advanceTimersByTime(2_900);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onStall).toHaveBeenCalledTimes(1);

    const onStall2 = vi.fn();
    const w2 = createStreamWatchdog({ stallMs: 1000, onStall: onStall2 });
    w2.start();
    w2.hold(Date.now() - 5000); // past: behaves like touch
    vi.advanceTimersByTime(1001);
    expect(onStall2).toHaveBeenCalledTimes(1);
    const onStall3 = vi.fn();
    const w3 = createStreamWatchdog({ stallMs: 1000, onStall: onStall3 });
    w3.start();
    w3.stop();
    vi.advanceTimersByTime(5000);
    expect(onStall3).not.toHaveBeenCalled();
  });
});

describe('deadlineFor door', () => {
  const base = { provider: 'p', error_type: 'e', failed_attempt: 1, max_retries: 3 };
  it('holds only quiet states, honors seconds/ms retry_at and retry_delay', () => {
    const now = 1_700_000_000_000;
    const mk = (o: Record<string, unknown>) => ({ ...base, ...o }) as never;
    expect(deadlineFor(mk({ state: 'retrying_now', retry_delay: 5 }), now)).toBeNull();
    expect(deadlineFor(mk({ state: 'recovered', retry_delay: 5 }), now)).toBeNull();
    expect(deadlineFor(mk({ state: 'scheduled', retry_delay: 5 }), now)).toBe(now + 5000);
    expect(deadlineFor(mk({ state: 'suspended', retry_delay: 2 }), now)).toBe(now + 2000);
    expect(deadlineFor(mk({ state: 'scheduled', retry_at: now / 1000 + 10 }), now)).toBe(now + 10_000);
    expect(deadlineFor(mk({ state: 'scheduled', retry_at: now + 7000 }), now)).toBe(now + 7000);
    expect(deadlineFor(mk({ state: 'scheduled', retry_at: now - 1000, retry_delay: 3 }), now)).toBe(now + 3000);
    expect(deadlineFor(mk({ state: 'scheduled' }), now)).toBeNull();
  });
});

describe('attemptResume door — extension-specific behavior preserved', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });
  const t = { runId: 'r', conversationId: 'c', requestId: 'q' };

  it('passes the chrome.storage kill switch through (option not dropped)', async () => {
    await chrome.storage.local.set({ 'matrx.stream.resume.enabled': false });
    const run = vi.fn();
    expect(await attemptResume(t, run)).toEqual({ resumed: false, reason: 'resume-disabled' });
    expect(run).not.toHaveBeenCalled();
  });

  it('409 resume_conflict still reports resume-run-error (not the package reason)', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409, code: 'resume_conflict' });
    const r = await attemptResume(t, async () => {
      throw err;
    });
    expect(r).toEqual({ resumed: false, reason: 'resume-run-error' });
  });

  it('result has exactly {resumed, reason} on success / decline / no-conversation', async () => {
    expect(await attemptResume(t, async () => 'run')).toEqual({ resumed: true, reason: 'ok' });
    expect(await attemptResume(t, async () => null)).toEqual({ resumed: false, reason: 'resume-run-declined' });
    expect(await attemptResume({ ...t, conversationId: null }, async () => 'x')).toEqual({
      resumed: false,
      reason: 'no-conversation-id',
    });
  });
});
