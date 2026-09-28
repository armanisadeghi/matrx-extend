// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tab: {
    id: 41,
    url: 'https://example.org/story',
    title: 'Story',
    documentId: 'document-a',
    pageKey: 'page-a',
  },
  runMode: vi.fn(),
  detect: vi.fn(),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ ...mocks.tab }),
  isCurrentPageIdentity: (key: string | null) => key !== null && key === mocks.tab.pageKey,
}));
vi.mock('@/lib/data-pattern/run-pattern', () => ({
  runMode: mocks.runMode,
  detectModeInPage: mocks.detect,
}));
import { useExtraction } from '@/hooks/use-extraction';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  cleanup();
  mocks.tab.documentId = 'document-a';
  mocks.tab.pageKey = 'page-a';
  mocks.runMode.mockReset();
  mocks.detect.mockReset();
});

it.each(['resolve', 'reject'] as const)(
  'same-URL document B never displays Snapshot A after late %s',
  async (settlement) => {
    const old = deferred<{ title: string }[]>();
    mocks.runMode.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ title: 'B' }]);
    mocks.detect.mockResolvedValue({ available: true, summary: 'B metadata' });
    const hook = renderHook(() => useExtraction('og_meta', { autoDetect: false }));
    let oldCompletion!: Promise<unknown>;
    act(() => {
      oldCompletion = hook.result.current.run({});
    });
    act(() => {
      mocks.tab.documentId = 'document-b';
      mocks.tab.pageKey = 'page-b';
      hook.rerender();
    });
    expect(hook.result.current.rows).toBeNull();
    expect(hook.result.current.source).toBeNull();
    await act(async () => {
      if (settlement === 'resolve') old.resolve([{ title: 'A' }]);
      else old.reject(new Error('A failed'));
      await oldCompletion;
    });
    expect(hook.result.current.rows).toBeNull();
    expect(hook.result.current.error).toBeNull();
    await act(async () => {
      await hook.result.current.run({});
    });
    expect(hook.result.current.rows).toEqual([{ title: 'B' }]);
    expect(hook.result.current.source?.url).toBe('https://example.org/story');
  },
);
