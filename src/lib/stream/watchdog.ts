/**
 * Stream stall watchdog.
 *
 * The streaming pipeline (sidepanel → SW → offscreen → fetch) has no built-in
 * timeout. If the offscreen document dies, the network hangs mid-stream, or the
 * server goes silent without sending a terminal `done`, the sidepanel never
 * learns the run ended — `isStreaming` stays true and the spinner spins forever
 * (the "stuck UI" bug).
 *
 * This watchdog is a dead-man's switch: every signal of life (any stream chunk,
 * including the server's `heartbeat` event) calls {@link StreamWatchdog.touch};
 * if nothing arrives for `stallMs`, {@link StreamWatchdog} fires `onStall` once
 * so the caller can clear the spinner and offer recovery.
 *
 * It is intentionally store-agnostic — the hook that owns the run wires `touch`
 * into its chunk listener and decides what `onStall` does (finalize, surface a
 * retry, attempt resume).
 *
 * ## Silence is not always death — {@link StreamWatchdog.hold}
 *
 * The server emits `provider_retry` when an upstream LLM provider fails and a
 * retry is scheduled. The stream then goes DELIBERATELY silent for the backoff
 * (`retry_delay`, which can far exceed `stallMs`) — no chunks, no heartbeat.
 *
 * A plain dead-man's switch cannot tell that apart from a hung stream, so it
 * would kill a perfectly healthy run mid-backoff and show the user a bogus
 * "connection lost". `hold(untilEpochMs)` is the fix: the run tells the watchdog
 * "I know why it's quiet, and I know when it will speak again." The timer is
 * pushed out to that deadline plus the normal grace, so a stall is still caught
 * if the retry never actually lands.
 */

export interface StreamWatchdogOptions {
  /** Milliseconds of total silence (no chunks, no heartbeat) before stalling. */
  stallMs: number;
  /** Fired at most once per `start()` cycle when the stall threshold is crossed. */
  onStall: () => void;
}

export interface StreamWatchdog {
  /** Begin (or restart) watching. Call when a run is sent. */
  start: () => void;
  /** Reset the timer — call on every sign of life. No-op once stalled/stopped. */
  touch: () => void;
  /**
   * Extend the deadline to `untilEpochMs` + the normal `stallMs` grace, for a
   * silence we EXPECT (a scheduled provider retry). Never shortens the deadline —
   * a hold that is already in the past degrades to a plain `touch()`. No-op once
   * stalled/stopped, same as `touch`.
   */
  hold: (untilEpochMs: number) => void;
  /** Stop watching. Call on done / error / cancel. */
  stop: () => void;
}

export function createStreamWatchdog(opts: StreamWatchdogOptions): StreamWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // `active` gates touch() so a late chunk after stop()/onStall() can't re-arm.
  let active = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const arm = (delayMs: number) => {
    clear();
    timer = setTimeout(
      () => {
        if (!active) return;
        active = false;
        timer = null;
        opts.onStall();
      },
      Math.max(0, delayMs),
    );
  };

  return {
    start() {
      active = true;
      arm(opts.stallMs);
    },
    touch() {
      if (active) arm(opts.stallMs);
    },
    hold(untilEpochMs) {
      if (!active) return;
      // The retry is due at `untilEpochMs`; give it the normal stall grace on top
      // to actually produce a chunk. Never shorten — a stale/past deadline just
      // behaves like a touch.
      const delay = untilEpochMs - Date.now() + opts.stallMs;
      arm(Math.max(opts.stallMs, delay));
    },
    stop() {
      active = false;
      clear();
    },
  };
}
