// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SeoAudit } from '@/lib/seo/audit';

vi.mock('@/lib/supabase/queries', () => ({
  fetchSeoAuditHistoryForUrl: async () => [],
  saveSeoAudit: vi.fn(),
}));
vi.mock('@/components/CopyMenu', () => ({ CopyMenu: () => null }));
vi.mock('@/features/seo/AiRecommendations', () => ({ AiRecommendations: () => null }));
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

// Captured public-page titles from the frozen native SEO acceptance run. The
// remaining fields keep the Chrome content-script result contract complete.
const oldSeo = {
  url: 'https://example.com/',
  fetched_at: 1790951018,
  title: { value: 'Example Domain', length: 14 },
  description: { value: null, length: 0 },
  canonical: null,
  robots: null,
  lang: 'en',
  hreflang: [],
  og: {},
  twitter: {},
  schema_types: [],
  headings: [],
  links: { internal: 0, external: 0 },
  images: { total: 0, missing_alt: 0 },
  word_count: 0,
  sentence_count: 0,
  flesch_reading_ease: null,
  performance: {
    nav_type: null,
    duration_ms: null,
    transfer_size_bytes: null,
    http_status: null,
    redirect_count: null,
  },
} satisfies SeoAudit;
const currentSeo = {
  ...oldSeo,
  url: 'https://www.iana.org/domains/reserved',
  title: { value: 'IANA-managed Reserved Domains', length: 29 },
} satisfies SeoAudit;

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function startOverlappingAudits() {
  const updated = event();
  const committed = event();
  const tab = { id: 41, active: true, url: oldSeo.url, title: oldSeo.title.value };
  let documentId = 'prior-document';
  const oldCapture = deferred();
  const replacementCapture = deferred();
  const sendMessage = vi
    .fn()
    .mockResolvedValueOnce({ __error: 'Prior document' })
    .mockImplementationOnce(() => oldCapture.promise)
    .mockImplementationOnce(() => replacementCapture.promise);
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
  tab.url = currentSeo.url;
  tab.title = currentSeo.title.value;
  documentId = 'iana-document';
  await act(async () => {
    committed.fire({ tabId: 41, frameId: 0, documentId });
  });
  await act(async () => {
    updated.fire(41, { status: 'loading' }, tab);
  });
  await act(async () => {
    updated.fire(41, { status: 'complete' }, tab);
  });
  expect(sendMessage).toHaveBeenCalledTimes(3);
  return { oldCapture, replacementCapture };
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

it('keeps the replacement busy when an older successful capture finishes first', async () => {
  const { oldCapture, replacementCapture } = await startOverlappingAudits();
  await act(async () => {
    oldCapture.resolve({ seo: oldSeo });
  });
  expect(screen.getByRole('button', { name: 'Audit this page' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(screen.queryByText(oldSeo.title.value)).toBeNull();
  await act(async () => {
    replacementCapture.resolve({ seo: currentSeo });
  });
  expect(screen.getByText(currentSeo.title.value)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Re-audit' }).hasAttribute('disabled')).toBe(false);
  expect(screen.queryByText(/Audit failed:/)).toBeNull();
});

it('keeps a successful current-page audit when an older success arrives last', async () => {
  const { oldCapture, replacementCapture } = await startOverlappingAudits();
  await act(async () => {
    replacementCapture.resolve({ seo: currentSeo });
  });
  await act(async () => {
    oldCapture.resolve({ seo: oldSeo });
  });
  expect(screen.getByText(currentSeo.title.value)).toBeTruthy();
  expect(screen.queryByText(oldSeo.title.value)).toBeNull();
  expect(screen.getByRole('button', { name: 'Re-audit' }).hasAttribute('disabled')).toBe(false);
  expect(screen.queryByText(/Audit failed:/)).toBeNull();
});

it('keeps a successful current-page audit when an older capture rejects last', async () => {
  const { oldCapture, replacementCapture } = await startOverlappingAudits();
  await act(async () => {
    replacementCapture.resolve({ seo: currentSeo });
  });
  await act(async () => {
    oldCapture.reject(new Error('Old port closed'));
  });
  expect(screen.getByText(currentSeo.title.value)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Re-audit' }).hasAttribute('disabled')).toBe(false);
  expect(screen.queryByText(/Audit failed:|Old port closed/)).toBeNull();
});
