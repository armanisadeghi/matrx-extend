/**
 * The DevTools console must not be a firehose.
 *
 * Every cross-context hop, fetch and Supabase call logs here — `send()`
 * alone emits a line with its payload for each internal message — and all
 * of it was mirrored to the console unconditionally, in every context. A
 * real problem was unfindable in it, and routine chatter read as "the app
 * is full of errors". The Debug tab keeps EVERYTHING either way; only the
 * console mirror is gated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
let changeListener: ((c: Record<string, { newValue?: unknown }>, a: string) => void) | undefined;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: () => Promise.resolve(),
      onMessage: { addListener: () => undefined },
    },
    storage: {
      local: {
        get: async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (patch: Record<string, unknown>) => {
          Object.assign(store, patch);
        },
      },
      onChanged: {
        addListener: (fn: typeof changeListener) => {
          changeListener = fn;
        },
      },
    },
  });
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('console mirror', () => {
  it('prints warnings and errors, swallows routine chatter, and obeys the switch', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { log, useDebugStore, setVerboseConsole } = await import('@/lib/debug/log');
    await Promise.resolve();

    log.info('sys', 'routine hop');
    log.success('sys', 'routine ok');
    expect(logSpy).not.toHaveBeenCalled();

    log.warn('sys', 'something is off');
    log.error('sys', 'something broke');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);

    // Nothing was HIDDEN — the Debug tab still has all four.
    expect(useDebugStore.getState().events).toHaveLength(4);

    // And an engineer who wants the firehose can still have it.
    await setVerboseConsole(true);
    log.info('sys', 'routine hop');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});
