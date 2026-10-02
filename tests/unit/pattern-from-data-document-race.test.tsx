import type { AnyMandateKey } from '@/lib/mandates';
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tab: {
    id: 41,
    url: 'https://example.org/events',
    title: 'Events',
    documentId: 'document-a',
    pageKey: 'page-a',
  },
  listener: null as null | ((chunk: unknown) => { ack: true }),
  send: vi.fn(async (..._args: unknown[]) => undefined),
  executeScript: vi.fn(),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ ...mocks.tab }),
  isCurrentPageIdentity: (key: string | null) => key !== null && key === mocks.tab.pageKey,
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (_channel: string, listener: (chunk: unknown) => { ack: true }) => {
    mocks.listener = listener;
    return () => {
      mocks.listener = null;
    };
  },
  send: mocks.send,
}));
vi.mock('@/lib/stream/watchdog', () => ({
  createStreamWatchdog: () => ({ start: vi.fn(), stop: vi.fn(), touch: vi.fn() }),
}));

import { usePatternFromData } from '@/hooks/use-pattern-from-data';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const input = {
  mandateKey: 'pattern-from-data' as AnyMandateKey,
  userInput: 'Extract event names',
  extractedRows: [{ name: 'Autumn Fair' }],
};
const pattern = JSON.stringify({
  kind: 'list_pattern',
  config: {
    list_root: 'main',
    item_selector: '.event',
    field_paths: [{ name: 'name', rel_selector: '.title' }],
  },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.tab.documentId = 'document-a';
  mocks.tab.pageKey = 'page-a';
  mocks.listener = null;
  mocks.send.mockClear();
  mocks.executeScript.mockReset();
});

it.each(['resolve', 'reject'] as const)(
  'a late document A probe %s cannot change document B pattern generation',
  async (settlement) => {
    const oldProbe = deferred<{ result: Record<string, string> }[]>();
    mocks.executeScript
      .mockResolvedValueOnce([{ result: ['<article>Autumn Fair</article>'] }])
      .mockReturnValueOnce(oldProbe.promise)
      .mockResolvedValueOnce([{ result: ['<article>Winter Fair</article>'] }])
      .mockResolvedValueOnce([{ result: { name: 'Winter Fair' } }]);
    vi.stubGlobal('chrome', { scripting: { executeScript: mocks.executeScript } });
    const hook = renderHook(usePatternFromData);

    await act(async () => {
      await hook.result.current.convert(input);
    });
    const startA = mocks.send.mock.calls.find(([channel]) => channel === 'stream:start')?.[1] as
      | { runId: string }
      | undefined;
    const runA = startA?.runId;
    expect(runA).toBeTruthy();
    act(() => {
      mocks.listener?.({ runId: runA, type: 'text', payload: { content: pattern } });
      mocks.listener?.({ runId: runA, type: 'done', payload: {} });
    });
    expect(mocks.executeScript).toHaveBeenCalledTimes(2);

    act(() => {
      mocks.tab.documentId = 'document-b';
      mocks.tab.pageKey = 'page-b';
      hook.rerender();
    });
    await act(async () => {
      await hook.result.current.convert(input);
    });
    expect(hook.result.current.running).toBe(true);
    if (settlement === 'resolve') {
      await act(async () => {
        oldProbe.resolve([{ result: { name: 'Autumn Fair' } }]);
        await oldProbe.promise;
      });
    } else {
      await act(async () => {
        oldProbe.reject(new Error('Old document is gone'));
        try {
          await oldProbe.promise;
        } catch {}
      });
    }
    expect(hook.result.current.running).toBe(true);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.result).toBeNull();

    const starts = mocks.send.mock.calls.filter(([channel]) => channel === 'stream:start');
    const runB = (starts.at(-1)?.[1] as { runId: string }).runId;
    await act(async () => {
      mocks.listener?.({ runId: runB, type: 'text', payload: { content: pattern } });
      mocks.listener?.({ runId: runB, type: 'done', payload: {} });
      await Promise.resolve();
    });
    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.liveProbe).toEqual({ name: 'Winter Fair' });
    expect(hook.result.current.result?.config.item_selector).toBe('.event');
  },
);

it('keeps document B stream error when document A probe rejects later', async () => {
  const oldProbe = deferred<{ result: Record<string, string> }[]>();
  mocks.executeScript
    .mockResolvedValueOnce([{ result: ['<article>Autumn Fair</article>'] }])
    .mockReturnValueOnce(oldProbe.promise)
    .mockResolvedValueOnce([{ result: ['<article>Winter Fair</article>'] }]);
  vi.stubGlobal('chrome', { scripting: { executeScript: mocks.executeScript } });
  const hook = renderHook(usePatternFromData);
  await act(async () => {
    await hook.result.current.convert(input);
  });
  const runA = (
    mocks.send.mock.calls.find(([channel]) => channel === 'stream:start')?.[1] as {
      runId: string;
    }
  ).runId;
  act(() => {
    mocks.listener?.({ runId: runA, type: 'text', payload: { content: pattern } });
    mocks.listener?.({ runId: runA, type: 'done', payload: {} });
    mocks.tab.documentId = 'document-b';
    mocks.tab.pageKey = 'page-b';
    hook.rerender();
  });
  await act(async () => {
    await hook.result.current.convert(input);
  });
  const starts = mocks.send.mock.calls.filter(([channel]) => channel === 'stream:start');
  const runB = (starts.at(-1)?.[1] as { runId: string }).runId;
  act(() => {
    mocks.listener?.({ runId: runB, type: 'error', payload: { message: 'B request refused' } });
  });
  expect(hook.result.current.error).toBe('B request refused');
  await act(async () => {
    oldProbe.reject(new Error('Old document is gone'));
    try {
      await oldProbe.promise;
    } catch {}
  });
  expect(hook.result.current.error).toBe('B request refused');
  expect(hook.result.current.running).toBe(false);
});

it.each(['resolve', 'reject'] as const)(
  'a late document A sample capture %s cannot start a stale conversion on B',
  async (settlement) => {
    const oldCapture = deferred<{ result: string[] }[]>();
    mocks.executeScript
      .mockReturnValueOnce(oldCapture.promise)
      .mockResolvedValueOnce([{ result: ['<article>Winter Fair</article>'] }]);
    vi.stubGlobal('chrome', { scripting: { executeScript: mocks.executeScript } });
    const hook = renderHook(usePatternFromData);
    let oldCompletion!: Promise<void>;
    act(() => {
      oldCompletion = hook.result.current.convert(input);
    });
    act(() => {
      mocks.tab.documentId = 'document-b';
      mocks.tab.pageKey = 'page-b';
      hook.rerender();
    });
    await act(async () => {
      await hook.result.current.convert(input);
    });
    expect(hook.result.current.running).toBe(true);
    expect(mocks.send.mock.calls.filter(([channel]) => channel === 'stream:start')).toHaveLength(1);
    await act(async () => {
      if (settlement === 'resolve')
        oldCapture.resolve([{ result: ['<article>Autumn Fair</article>'] }]);
      else oldCapture.reject(new Error('Old document is gone'));
      await oldCompletion;
    });
    expect(mocks.send.mock.calls.filter(([channel]) => channel === 'stream:start')).toHaveLength(1);
    expect(hook.result.current.running).toBe(true);
    expect(hook.result.current.error).toBeNull();
  },
);
