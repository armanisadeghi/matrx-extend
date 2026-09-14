import { describe, expect, it, vi } from 'vitest';

const executeScript = vi.fn();
const addListener = vi.fn();
const removeListener = vi.fn();

vi.stubGlobal('chrome', {
  scripting: { executeScript },
  runtime: { onMessage: { addListener, removeListener } },
});

import { scrollToLoadLazy } from '@/lib/scrape/page-ready';

describe('scrollToLoadLazy', () => {
  it('settles after scrolling before resolving to prevent capture of lazy graph shells', async () => {
    let releaseSettle: (() => void) | undefined;
    const settleDone = new Promise<void>((resolve) => {
      releaseSettle = resolve;
    });
    executeScript
      .mockResolvedValueOnce([
        { result: { steps: 2, bottom: true, stuck: false, timedOut: false } },
      ])
      .mockImplementationOnce(() => settleDone);

    const pending = scrollToLoadLazy(42, { restoreScroll: false });
    await Promise.resolve();
    expect(executeScript).toHaveBeenCalledTimes(2);

    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    releaseSettle?.();
    await pending;
    expect(executeScript.mock.calls[0]?.[0]?.target).toEqual({ tabId: 42 });
    expect(executeScript.mock.calls[1]?.[0]?.target).toEqual({ tabId: 42 });
  });
});
