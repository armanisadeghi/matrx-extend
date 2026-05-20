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

  const arm = () => {
    clear();
    timer = setTimeout(() => {
      if (!active) return;
      active = false;
      timer = null;
      opts.onStall();
    }, opts.stallMs);
  };

  return {
    start() {
      active = true;
      arm();
    },
    touch() {
      if (active) arm();
    },
    stop() {
      active = false;
      clear();
    },
  };
}
