import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ensureOffscreen creation barrier', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('keeps every concurrent caller behind the same in-flight document creation', async () => {
    let resolveContexts!: (contexts: chrome.runtime.ExtensionContext[]) => void;
    let resolveCreate!: () => void;
    const createDocument = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const getContexts = vi.fn(
      () =>
        new Promise<chrome.runtime.ExtensionContext[]>((resolve) => {
          resolveContexts = resolve;
        }),
    );

    vi.stubGlobal('chrome', {
      runtime: { getContexts },
      offscreen: { createDocument },
    });

    const { ensureOffscreen } = await import('@/lib/stream/offscreen-proxy');
    const first = ensureOffscreen();
    let secondResolved = false;
    const second = ensureOffscreen().then(() => {
      secondResolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(secondResolved).toBe(false);
    expect(getContexts).toHaveBeenCalledTimes(1);
    expect(createDocument).not.toHaveBeenCalled();

    resolveContexts([]);
    await vi.waitFor(() => expect(createDocument).toHaveBeenCalledTimes(1));

    resolveCreate();
    await Promise.all([first, second]);
    expect(secondResolved).toBe(true);
  });

  it('holds a recovery acquisition until reload cleanup settles', async () => {
    let releaseCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const getContexts = vi.fn(async () => []);
    const createDocument = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      runtime: { getContexts },
      offscreen: { createDocument },
    });

    const { deferOffscreenAcquisitionUntil, ensureOffscreen } = await import(
      '@/lib/stream/offscreen-proxy'
    );
    deferOffscreenAcquisitionUntil(cleanup);
    const recoveryAcquire = ensureOffscreen();
    await Promise.resolve();
    expect(getContexts).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();

    releaseCleanup();
    await recoveryAcquire;
    expect(createDocument).toHaveBeenCalledOnce();
  });

  it('fails open after cleanup rejects or exceeds its bounded wait', async () => {
    vi.useFakeTimers();
    const getContexts = vi.fn(async () => []);
    const createDocument = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      runtime: { getContexts },
      offscreen: { createDocument },
    });
    const { deferOffscreenAcquisitionUntil, ensureOffscreen } = await import(
      '@/lib/stream/offscreen-proxy'
    );

    deferOffscreenAcquisitionUntil(Promise.reject(new Error('chrome close rejected')));
    await ensureOffscreen();
    expect(createDocument).toHaveBeenCalledOnce();

    vi.resetModules();
    const hanging = new Promise<void>(() => undefined);
    const next = await import('@/lib/stream/offscreen-proxy');
    next.deferOffscreenAcquisitionUntil(hanging);
    const afterTimeout = next.ensureOffscreen();
    await vi.advanceTimersByTimeAsync(5_000);
    await afterTimeout;
    expect(createDocument).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
