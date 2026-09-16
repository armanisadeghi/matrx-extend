import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ensureOffscreen creation barrier', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('keeps every concurrent caller behind the same in-flight document creation', async () => {
    let resolveCreate!: () => void;
    const createDocument = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const getContexts = vi
      .fn()
      .mockResolvedValueOnce([])
      // Chrome can expose the new context before createDocument() has
      // completed. That must not let a second caller send into it early.
      .mockResolvedValueOnce([{ contextType: 'OFFSCREEN_DOCUMENT' }]);

    vi.stubGlobal('chrome', {
      runtime: { getContexts },
      offscreen: { createDocument },
    });

    const { ensureOffscreen } = await import('@/lib/stream/offscreen-proxy');
    const first = ensureOffscreen();
    await vi.waitFor(() => expect(createDocument).toHaveBeenCalledTimes(1));

    let secondResolved = false;
    const second = ensureOffscreen().then(() => {
      secondResolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(secondResolved).toBe(false);
    expect(getContexts).toHaveBeenCalledTimes(1);

    resolveCreate();
    await Promise.all([first, second]);
    expect(secondResolved).toBe(true);
  });
});
