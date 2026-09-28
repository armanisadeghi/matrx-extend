import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  oldUrl: 'https://calendar.invalid/old-route',
  run: vi.fn(),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: 37, url: h.oldUrl, title: 'Calendar' }),
}));
vi.mock('@/lib/data-pattern/document-network-transport', () => ({
  openNetworkPageLoadDiscovery: (...args: unknown[]) => h.run(...args),
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => {} }));

import { useNetworkCapture } from '@/hooks/use-network-capture';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([
  ['https://calendar.invalid/old-route', 'https://calendar.invalid/current-route', 'calendar.invalid', '/current-route'],
  ['https://news.invalid/previous', 'https://events.invalid/upcoming', 'events.invalid', '/upcoming'],
])('save source follows approved %s -> %s while React still shows the prior route', async (staleUrl, approvedUrl, host, pathname) => {
  h.oldUrl = staleUrl;
  h.run.mockImplementation(async (_tabId, options) => {
    options.onEvent({
      tab_id: 37, capture_id: 'new-capture', document_key: 'new-document',
      source: 'fetch', method: 'POST', url: 'https://calendar.invalid/api/events',
      request_body_key: 'sha256:' + 'a'.repeat(64), request_sequence: 1,
      status: 200, ts_ms: 1, body: '[{"title":"Opening night"}]',
      body_size: 27, body_truncated: false,
    });
    return {
      ok: true, pageUrl: approvedUrl,
      documentId: 'new-document', eventCount: 1,
    };
  });
  const { result } = renderHook(() => useNetworkCapture());
  await act(async () => { await result.current.capturePageLoad(); });
  expect(result.current.source).toEqual({
    url: approvedUrl, host, pathname,
  });
  expect(result.current.events).toHaveLength(1);
  expect(result.current.events[0]?.request_body_key).toBe('sha256:' + 'a'.repeat(64));
});

it('failed page-load capture removes partial events and source so they cannot be saved', async () => {
  h.run.mockImplementation(async (_tabId, options) => {
    options.onEvent({ tab_id: 37, capture_id: 'partial', document_key: 'replaced' });
    throw new Error('The replay document was replaced.');
  });
  const { result } = renderHook(() => useNetworkCapture());
  await act(async () => { await result.current.capturePageLoad(); });
  expect(result.current.source).toBeNull();
  expect(result.current.events).toEqual([]);
  expect(result.current.error).toMatch(/document was replaced/);
});
