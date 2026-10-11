/**
 * Guided capture — "Scroll for me": the page scrolls itself, at a human pace, so
 * a feed keeps loading posts into the accumulator (the same capture pipeline
 * the person's own scrolling feeds). It only ever runs because the person
 * pressed the button, stops at the chosen count or the end of the feed, and
 * is cancellable at any moment. Pure of chrome.* so it is unit-tested with fake
 * timers; the overlay supplies the page hooks.
 */

/** Defaults live here and are overridable per run (limits are knobs, not constants in logic). */
export const AUTOSCROLL_DEFAULTS = {
  /** Fraction of the viewport moved per step. */
  stepViewportFraction: 0.8,
  /** Human-ish pause between steps. */
  minPauseMs: 900,
  maxPauseMs: 1700,
  /** Steps with no new posts and no taller page before the feed counts as finished. */
  stallSteps: 5,
  /** Hard safety ceiling so a runaway feed cannot scroll forever. */
  maxSteps: 2000,
} as const;

export type AutoScrollOptions = Partial<{
  -readonly [K in keyof typeof AUTOSCROLL_DEFAULTS]: number;
}>;

export type AutoScrollEnd = 'target' | 'end' | 'cancelled' | 'ceiling';

export interface AutoScrollHooks {
  /** Posts collected so far. */
  count(): number;
  /** Scroll the page down by this many pixels. */
  scrollBy(px: number): void;
  viewportHeight(): number;
  /** Total scrollable height, to notice a page that is still growing. */
  pageHeight(): number;
  /** Called after every step with the live count. */
  onTick(count: number): void;
  /** Resolves after ms; rejects/returns early when cancelled. Injected for tests. */
  sleep(ms: number): Promise<void>;
  random?(): number;
}

/** `target` of null means "until the end of the feed". */
export async function runAutoScroll(
  hooks: AutoScrollHooks,
  target: number | null,
  signal: AbortSignal,
  options: AutoScrollOptions = {},
): Promise<AutoScrollEnd> {
  const o = { ...AUTOSCROLL_DEFAULTS, ...options };
  const random = hooks.random ?? Math.random;
  let stalled = 0;
  let lastCount = hooks.count();
  let lastHeight = hooks.pageHeight();
  for (let step = 0; step < o.maxSteps; step++) {
    if (signal.aborted) return 'cancelled';
    if (target !== null && hooks.count() >= target) return 'target';
    hooks.scrollBy(Math.max(200, Math.round(hooks.viewportHeight() * o.stepViewportFraction)));
    await hooks.sleep(o.minPauseMs + random() * (o.maxPauseMs - o.minPauseMs));
    if (signal.aborted) return 'cancelled';
    const count = hooks.count();
    const height = hooks.pageHeight();
    hooks.onTick(count);
    stalled = count > lastCount || height > lastHeight ? 0 : stalled + 1;
    lastCount = count;
    lastHeight = height;
    if (target !== null && count >= target) return 'target';
    if (stalled >= o.stallSteps) return 'end';
  }
  return 'ceiling';
}

/** The sentence under the counter while and after scrolling. */
export function scrollSentence(end: AutoScrollEnd | null, count: number, noun: string): string {
  const n = `${count} ${noun}`;
  if (end === null) return `${n} · scrolling…`;
  if (end === 'target') return `${n} · reached your number. Press Capture.`;
  if (end === 'end' && count === 0)
    return `No ${noun} showed up on this page. Log in or open the profile, then scroll again.`;
  if (end === 'end') return `${n} · reached the end of the feed. Press Capture.`;
  if (end === 'ceiling') return `${n} · paused for now. Press Capture, or scroll again.`;
  return `${n} · stopped. Press Capture, or scroll again.`;
}
