// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  page: {
    id: 37,
    url: 'https://example.org/story',
    title: 'Story',
    documentId: 'document-a',
    pageKey: 'page-a',
  },
  listeners: new Map<string, (payload: unknown) => unknown>(),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ ...state.page }),
  isCurrentPageIdentity: (key: string | null) => key !== null && key === state.page.pageKey,
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, callback: (payload: unknown) => unknown) => {
    state.listeners.set(kind, callback);
    return () => {
      state.listeners.delete(kind);
    };
  },
}));
vi.mock('@/lib/data-pattern/document-network-transport', () => ({
  openNetworkPageLoadDiscovery: vi.fn(),
}));

import { useNetworkCapture } from '@/hooks/use-network-capture';
import { stampDocumentSender } from '@/lib/background/document-event-relay';
import { CHANNELS } from '@/lib/messaging/schemas';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.listeners.clear();
  state.page = {
    id: 37,
    url: 'https://example.org/story',
    title: 'Story',
    documentId: 'document-a',
    pageKey: 'page-a',
  };
});

it('overwrites spoofed payload identity with Chrome sender identity', () => {
  const sender = { tab: { id: 37 }, documentId: 'document-a' } as Parameters<
    typeof stampDocumentSender
  >[1];
  expect(
    stampDocumentSender({ tab_id: 999, document_id: 'document-b', body: 'A' }, sender),
  ).toEqual({
    tab_id: 37,
    document_id: 'document-a',
    body: 'A',
  });
  expect(
    stampDocumentSender({ body: 'unknown' }, { tab: { id: 37 } } as Parameters<
      typeof stampDocumentSender
    >[1]),
  ).toBeNull();
});

it('rejects queued A responses after B starts capture on the same tab and URL', async () => {
  vi.stubGlobal('chrome', { scripting: { executeScript: vi.fn(async () => []) } });
  const hook = renderHook(useNetworkCapture);
  await act(async () => {
    await hook.result.current.start();
  });
  const emit = state.listeners.get(CHANNELS.NET_CAPTURE_EVENT);
  if (!emit) throw new Error('ordinary Network relay listener was not installed');
  act(() => {
    emit({ tab_id: 37, document_id: 'document-a', body: 'A before reload' });
  });
  expect(hook.result.current.events).toHaveLength(1);

  await act(async () => {
    state.page = { ...state.page, documentId: 'document-b', pageKey: 'page-b' };
    hook.rerender();
  });
  await act(async () => {
    await hook.result.current.start();
  });
  act(() => {
    emit({ tab_id: 37, document_id: 'document-a', body: 'late A' });
    emit({ tab_id: 37, document_id: 'document-b', body: 'current B' });
  });
  expect(hook.result.current.events.map((event) => event.body)).toEqual(['current B']);
});
