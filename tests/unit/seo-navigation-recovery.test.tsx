// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries', () => ({
  fetchSeoAuditHistoryForUrl: async () => [],
  saveSeoAudit: vi.fn(),
}));
vi.mock('@/features/seo/AiRecommendations', () => ({ AiRecommendations: () => null }));
vi.mock('@/features/seo/SeoDetails', () => ({ SeoDetails: () => null }));
vi.mock('@/features/seo/SeoVerdict', () => ({ SeoVerdict: () => null }));

import { SeoView } from '@/features/seo/SeoView';

function event() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    addListener: (listener: (...args: unknown[]) => void) => listeners.add(listener),
    removeListener: (listener: (...args: unknown[]) => void) => listeners.delete(listener),
    fire: (...args: unknown[]) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('restarts the audit when a settled response was discarded during a second loading event', async () => {
  const updated = event();
  const committed = event();
  const tab = { id: 41, active: true, url: 'https://www.airbnb.com/', title: 'Airbnb' };
  let documentId = 'prior-document';
  let resolveCapture!: (value: unknown) => void;
  const sendMessage = vi
    .fn()
    .mockResolvedValueOnce({ __error: 'Prior document' })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    )
    .mockResolvedValueOnce({ __error: 'Fresh capture completed' });
  vi.stubGlobal('chrome', {
    tabs: {
      query: async () => [{ ...tab }],
      sendMessage,
      onActivated: event(),
      onUpdated: updated,
    },
    windows: { onFocusChanged: event() },
    webNavigation: {
      getFrame: async () => ({ documentId, url: tab.url, errorOccurred: false }),
      onBeforeNavigate: event(),
      onCommitted: committed,
      onErrorOccurred: event(),
    },
  });
  await act(async () => {
    render(<SeoView />);
  });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  documentId = 'airbnb-document';
  await act(async () => {
    committed.fire({ tabId: 41, frameId: 0, documentId });
  });
  expect(sendMessage).toHaveBeenCalledTimes(2);
  await act(async () => {
    updated.fire(41, { status: 'loading' }, tab);
  });
  await act(async () => {
    resolveCapture({ __error: 'Discarded response' });
  });
  await act(async () => {
    updated.fire(41, { status: 'complete' }, tab);
  });
  expect(
    sendMessage,
    'A discarded capture must restart when the same document becomes ready',
  ).toHaveBeenCalledTimes(3);
  expect(screen.getByRole('button', { name: 'Audit this page' }).hasAttribute('disabled')).toBe(
    false,
  );
  expect(screen.getByText('Audit failed: Fresh capture completed')).toBeTruthy();
});
