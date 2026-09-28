// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tab: { id: 41, url: 'https://harbor-dental.test/intake', documentId: 'document-a', pageKey: 'page-a' },
  capture: vi.fn(),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ ...mocks.tab }),
  isCurrentPageIdentity: (key: string | null) => key !== null && key === mocks.tab.pageKey,
}));
vi.mock('@/lib/scrape/capture-with-fallback', () => ({ captureWithFallback: mocks.capture }));
vi.mock('@/lib/scrape/page-ready', () => ({ scrollToLoadLazy: vi.fn(async () => undefined) }));

import { useAutoScrape } from '@/hooks/use-auto-scrape';
import { useAutoScrapeStore } from '@/state/auto-scrape';
import { useSettingsStore } from '@/state/settings';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const soup = (title: string) => ({ url: 'https://harbor-dental.test/intake', article: { title } });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.capture.mockReset();
  mocks.tab.documentId = 'document-a';
  mocks.tab.pageKey = 'page-a';
  useAutoScrapeStore.getState().clear();
  useAutoScrapeStore.getState().setInFlight(false);
});

it('same-URL reload rejects late A and captures B from its exact document', async () => {
  vi.useFakeTimers();
  useSettingsStore.setState({ scrapeAutoOnLoad: true, scrapeAutoMode: 'capture' });
  const old = deferred<unknown>();
  mocks.capture.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, soup: soup('B intake') });
  const hook = renderHook(() => useAutoScrape());
  await act(async () => { await vi.advanceTimersByTimeAsync(601); });
  expect(mocks.capture).toHaveBeenNthCalledWith(1, 41, mocks.tab.url, 'document-a');
  act(() => {
    mocks.tab.documentId = 'document-b';
    mocks.tab.pageKey = 'page-b';
    hook.rerender();
  });
  expect(useAutoScrapeStore.getState().current).toBeNull();
  await act(async () => { old.resolve({ ok: true, soup: soup('A intake') }); await old.promise; });
  expect(useAutoScrapeStore.getState().current).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(601); });
  expect(mocks.capture).toHaveBeenNthCalledWith(2, 41, mocks.tab.url, 'document-b');
  expect(useAutoScrapeStore.getState().current?.pageKey).toBe('page-b');
  expect(useAutoScrapeStore.getState().current?.soup.article.title).toBe('B intake');
});
