/**
 * Transient plaintext holder — the ONLY place a revealed credential is allowed
 * to sit in this extension, and only for as long as a human is looking at it.
 *
 * Mirrors the web app's `useTransientSecret`
 * (matrx-frontend/features/secrets/vault-hooks.ts): one value, in memory,
 * auto-cleared after ~30s, dropped on unmount.
 *
 * Non-negotiables this module encodes:
 *   - The value lives in a closure / component state. It is NEVER written to
 *     chrome.storage, localStorage, sessionStorage, IndexedDB, a zustand
 *     store, a URL, a log line, a tool result, or model context.
 *   - Holding a NEW value replaces the old one and restarts the clock, so a
 *     second reveal can never extend the first one's exposure.
 *   - `clear()` is idempotent and cancels the pending timer.
 *
 * The pure core (`createTransientSecret`) carries the behaviour so it can be
 * unit-tested without React; `useTransientSecret` is the thin React shell.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a revealed value stays on screen before it clears itself. */
export const REVEAL_CLEAR_MS = 30_000;

export interface TransientSecret {
  /** The plaintext currently held, or null. */
  get: () => string | null;
  /** Hold a new value, replacing any previous one and restarting the clock. */
  hold: (value: string) => void;
  /** Drop the value now and cancel the pending auto-clear. */
  clear: () => void;
  /** Milliseconds until auto-clear, or null when nothing is held. */
  msRemaining: () => number | null;
}

export interface TransientSecretOptions {
  clearAfterMs?: number;
  /** Called whenever the held value changes (including on auto-clear). */
  onChange?: (value: string | null) => void;
  /** Injected for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export function createTransientSecret(options: TransientSecretOptions = {}): TransientSecret {
  const clearAfterMs = options.clearAfterMs ?? REVEAL_CLEAR_MS;
  const now = options.now ?? (() => Date.now());
  const onChange = options.onChange;

  let value: string | null = null;
  let expiresAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const clear = (): void => {
    cancelTimer();
    expiresAt = null;
    if (value === null) return;
    value = null;
    onChange?.(null);
  };

  const hold = (next: string): void => {
    // Replace, never append: a second reveal must not extend the first's
    // exposure window, and two values must never be held at once.
    cancelTimer();
    value = next;
    expiresAt = now() + clearAfterMs;
    onChange?.(next);
    timer = setTimeout(clear, clearAfterMs);
  };

  return {
    get: () => value,
    hold,
    clear,
    msRemaining: () => (expiresAt === null ? null : Math.max(0, expiresAt - now())),
  };
}

/**
 * React shell. Holds ONE revealed value in component state with the same
 * auto-clear guarantees, and drops it on unmount.
 */
export function useTransientSecret(clearAfterMs: number = REVEAL_CLEAR_MS): {
  value: string | null;
  hold: (value: string) => void;
  clear: () => void;
} {
  const [value, setValue] = useState<string | null>(null);
  const coreRef = useRef<TransientSecret | null>(null);
  if (coreRef.current === null) {
    coreRef.current = createTransientSecret({ clearAfterMs, onChange: setValue });
  }

  const hold = useCallback((next: string) => coreRef.current?.hold(next), []);
  const clear = useCallback(() => coreRef.current?.clear(), []);

  // Unmount drops the value and cancels the timer — closing the panel must not
  // leave plaintext alive in a detached closure.
  useEffect(() => {
    const core = coreRef.current;
    return () => core?.clear();
  }, []);

  return { value, hold, clear };
}
