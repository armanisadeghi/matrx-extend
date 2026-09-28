import { afterEach, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  pageKey: 'page-a', documentId: 'document-a', capture: vi.fn(),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  getActiveTabIdentitySnapshot: () => ({ id: 41, url: 'https://harbor-dental.test/intake', pageKey: harness.pageKey, documentId: harness.documentId }),
  isCurrentPageIdentity: (key: string) => key === harness.pageKey,
}));
vi.mock('@/lib/scrape/capture-with-fallback', () => ({ captureWithFallback: harness.capture }));
vi.mock('@/lib/scrape/page-ready', () => ({ scrollToLoadLazy: vi.fn(async () => undefined) }));
vi.mock('@/lib/debug/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

import { refreshPageContextBeforeSend } from '@/lib/chat/refresh-page-context';
import { useAutoScrapeStore } from '@/state/auto-scrape';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
afterEach(() => {
  vi.unstubAllGlobals();
  harness.capture.mockReset();
  harness.pageKey = 'page-a';
  harness.documentId = 'document-a';
  useAutoScrapeStore.getState().clear();
  useAutoScrapeStore.getState().setInFlight(false);
});

it('late A failure leaves B refresh status owned by B', async () => {
  const a = deferred<{ ok: false; reason: string }>();
  const b = deferred<{ ok: true; soup: { url: string; article: { title: string } } }>();
  harness.capture.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const chromeStub = { scripting: { executeScript: vi.fn(async () => [{ result: 0 }]) } };
  vi.stubGlobal('chrome', chromeStub);
  const old = refreshPageContextBeforeSend({ autoFullScrollOnFirstSubmit: true });
  await vi.waitFor(() => expect(harness.capture).toHaveBeenCalledTimes(1));
  harness.pageKey = 'page-b';
  harness.documentId = 'document-b';
  const latest = refreshPageContextBeforeSend({ autoFullScrollOnFirstSubmit: true });
  await vi.waitFor(() => expect(harness.capture).toHaveBeenCalledTimes(2));
  a.resolve({ ok: false, reason: 'capture-failed' });
  await old;
  expect(useAutoScrapeStore.getState().inFlight).toBe(true);
  expect(useAutoScrapeStore.getState().lastError).toBeNull();
  b.resolve({ ok: true, soup: { url: 'https://harbor-dental.test/intake', article: { title: 'B intake' } } });
  await latest;
  expect(useAutoScrapeStore.getState().inFlight).toBe(false);
  expect(useAutoScrapeStore.getState().current?.pageKey).toBe('page-b');
});

it('late A success cannot replace B while B owns the refresh', async () => {
  const a = deferred<{ ok: true; soup: { url: string; article: { title: string } } }>();
  const b = deferred<{ ok: true; soup: { url: string; article: { title: string } } }>();
  harness.capture.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  vi.stubGlobal('chrome', { scripting: { executeScript: vi.fn(async () => [{ result: 0 }]) } });
  const old = refreshPageContextBeforeSend({ autoFullScrollOnFirstSubmit: true });
  await vi.waitFor(() => expect(harness.capture).toHaveBeenCalledTimes(1));
  harness.pageKey = 'page-b';
  harness.documentId = 'document-b';
  const latest = refreshPageContextBeforeSend({ autoFullScrollOnFirstSubmit: true });
  await vi.waitFor(() => expect(harness.capture).toHaveBeenCalledTimes(2));
  a.resolve({ ok: true, soup: { url: 'https://harbor-dental.test/intake', article: { title: 'A intake' } } });
  await old;
  expect(useAutoScrapeStore.getState().inFlight).toBe(true);
  expect(useAutoScrapeStore.getState().current).toBeNull();
  b.resolve({ ok: true, soup: { url: 'https://harbor-dental.test/intake', article: { title: 'B intake' } } });
  await latest;
  expect(useAutoScrapeStore.getState().current?.soup.article.title).toBe('B intake');
  expect(useAutoScrapeStore.getState().inFlight).toBe(false);
});
