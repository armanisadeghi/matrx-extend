// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tab: {
    id: 41,
    url: 'https://harbor-dental.test/intake',
    title: 'New patient intake',
    documentId: 'document-a',
    pageKey: 'page-a',
    identityError: null,
  },
  capture: vi.fn(),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ ...mocks.tab }),
  getActiveTabIdentitySnapshot: () => ({ ...mocks.tab }),
  isCurrentPageIdentity: (key: string | null) => key !== null && key === mocks.tab.pageKey,
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => undefined }));
vi.mock('@/lib/scrape/capture-with-fallback', () => ({ captureWithFallback: mocks.capture }));
vi.mock('@/lib/scrape/page-ready', () => ({ scrollToLoadLazy: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/queries', () => ({ saveSeoAudit: vi.fn() }));

import { useScrape } from '@/hooks/use-scrape';
import { useScrapeStore } from '@/state/scrape';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

const soup = (title: string) => ({ url: 'https://harbor-dental.test/intake', article: { title } });

afterEach(() => {
  cleanup();
  mocks.capture.mockReset();
  mocks.tab.documentId = 'document-a';
  mocks.tab.pageKey = 'page-a';
  useScrapeStore.getState().setCurrent(null);
  useScrapeStore.getState().setLoading(false);
  useScrapeStore.getState().setError(null);
});

it.each(['fast', 'deep'] as const)(
  '%s capture stays busy while the real capture pipeline is pending',
  async (mode) => {
    const pending = deferred<unknown>();
    mocks.capture.mockReturnValue(pending.promise);
    const hook = renderHook(() => useScrape());
    let capture!: Promise<unknown>;
    act(() => {
      capture = hook.result.current.captureActiveTab({ mode });
    });
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledOnce());
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.activeMode).toBe(mode);
    await act(async () => {
      pending.resolve({ ok: true, soup: soup(`${mode} intake`) });
      await capture;
    });
    expect(hook.result.current.loading).toBe(false);
    expect(useScrapeStore.getState().current?.article.title).toBe(`${mode} intake`);
  },
);

it('late A manual capture cannot replace B at the same URL', async () => {
  const old = deferred<unknown>();
  mocks.capture
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce({ ok: true, soup: soup('B intake') });
  const hook = renderHook(() => useScrape());
  let oldCapture!: Promise<unknown>;
  act(() => {
    oldCapture = hook.result.current.captureActiveTab();
  });
  expect(mocks.capture).toHaveBeenNthCalledWith(1, 41, mocks.tab.url, 'document-a');
  act(() => {
    mocks.tab.documentId = 'document-b';
    mocks.tab.pageKey = 'page-b';
    hook.rerender();
  });
  await act(async () => {
    old.resolve({ ok: true, soup: soup('A intake') });
    await oldCapture;
  });
  expect(useScrapeStore.getState().current).toBeNull();
  await act(async () => {
    await hook.result.current.captureActiveTab();
  });
  expect(mocks.capture).toHaveBeenNthCalledWith(2, 41, mocks.tab.url, 'document-b');
  expect(useScrapeStore.getState().pageKey).toBe('page-b');
  expect(useScrapeStore.getState().current?.article.title).toBe('B intake');
});
