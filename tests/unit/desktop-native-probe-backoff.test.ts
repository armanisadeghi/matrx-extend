/**
 * The native-host probe must not retry a host that is not installed twice a
 * minute for the life of the browser. Most machines never install
 * `com.matrx.local` — matrx-local's own dev machines included — and the
 * desktop alarm calls probeNative() first on every 30s tick.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/env', () => ({ ENV: { DESKTOP_NATIVE_HOST: 'com.matrx.local' } }));

function installChrome(onConnect: () => void): void {
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: { message: 'Specified native messaging host not found.' },
      connectNative: () => {
        onConnect();
        const disconnectListeners: Array<() => void> = [];
        const port = {
          onMessage: { addListener: () => undefined },
          onDisconnect: {
            addListener: (fn: () => void) => {
              disconnectListeners.push(fn);
              // The host is missing: Chrome disconnects immediately.
              queueMicrotask(() => fn());
            },
          },
          postMessage: () => undefined,
        };
        return port;
      },
    },
  });
}

describe('native host probe', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('backs off after a miss and re-probes when a person asks', async () => {
    let connects = 0;
    installChrome(() => {
      connects += 1;
    });
    const { probeNative, resetNativeProbeBackoff } = await import('@/lib/desktop/native');

    await expect(probeNative()).resolves.toBeNull();
    expect(connects).toBe(1);

    // The alarm keeps ticking. Nothing changed, so do not reconnect.
    await expect(probeNative()).resolves.toBeNull();
    await expect(probeNative()).resolves.toBeNull();
    expect(connects).toBe(1);

    // A person pressed Re-discover.
    resetNativeProbeBackoff();
    await expect(probeNative()).resolves.toBeNull();
    expect(connects).toBe(2);
  });
});
