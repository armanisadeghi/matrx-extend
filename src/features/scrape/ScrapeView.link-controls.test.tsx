import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  copiedText: vi.fn(),
  tab: {
    url: 'https://fieldnotes.example/garden/seed-starting',
    title: 'Starting seeds indoors',
    id: 7,
    documentId: 'seed-page',
    identityStatus: 'ready' as const,
    identityError: null,
    pageKey: 'seed-page',
  },
}));

vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => mocks.tab,
  isCurrentPageIdentity: (key: string | null) => Boolean(key),
}));
vi.mock('@/hooks/use-page-recognition', () => ({
  usePageRecognition: () => ({
    capturedAt: null,
    capturedId: null,
    loading: false,
    checkFailed: false,
    checkNeedsOrganization: false,
  }),
}));
vi.mock('@/hooks/use-page-scroll-sync', () => ({ usePageScrollSync: () => undefined }));
vi.mock('@/hooks/use-scrape', async () => {
  const { useScrapeStore } = await import('@/state/scrape');
  return {
    useScrape: () => ({
      current: useScrapeStore((state) => state.current),
      loading: false,
      activeMode: null,
      progress: null,
      error: null,
      edited: useScrapeStore((state) => state.edited),
      captureActiveTab: vi.fn(),
      reloadActiveTab: vi.fn(),
      clearError: vi.fn(),
      save: vi.fn(),
      markSaved: useScrapeStore((state) => state.markSaved),
      markUnsaved: useScrapeStore((state) => state.markUnsaved),
      launchDiagnose: vi.fn(),
    }),
  };
});
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => 'org-seed-garden',
  onActiveOrganizationChange: () => () => undefined,
}));
vi.mock('@/lib/clipboard/copy', () => ({
  copyToClipboard: async (text: string) => {
    mocks.copiedText(text);
    return true;
  },
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: null, isAdmin: false, loading: false }),
}));
vi.mock('@/components/AddToProjectButton', () => ({ AddToProjectButton: () => null }));
vi.mock('@/components/MarkdownView', () => ({ MarkdownView: () => null }));
vi.mock('@/features/scrape/DiagnoseCard', () => ({
  DiagnoseCard: () => null,
  DiagnoseLauncher: () => null,
}));
vi.mock('@/features/scrape/UnsavedCapturesCard', () => ({ UnsavedCapturesCard: () => null }));
vi.mock('@/features/scrape/FileSourcePanel', () => ({ FileSourcePanel: () => null }));
vi.mock('@/features/seo/SeoDetails', () => ({ SeoDetails: () => null }));

import type { SoupResult } from '@/lib/scrape/pipeline';
import { useScrapeStore } from '@/state/scrape';
import { ScrapeView } from './ScrapeView';

// A home gardener uses these links to return to seed-starting guidance and a printable planting chart.
const capture: SoupResult = {
  url: mocks.tab.url,
  capturedAt: 1_791_000_000_000,
  metadata: {
    title: 'Starting seeds indoors',
    description: null,
    canonical: null,
    lang: 'en',
    og: {},
    twitter: {},
    schemaTypes: [],
    published_time: null,
    modified_time: null,
  },
  article: {
    title: 'Starting seeds indoors',
    byline: null,
    content_html_safe: '<p>Use a light.</p>',
    content_markdown: 'Use a light.',
    excerpt: null,
    extractor: 'readability',
    word_count: 3,
    reading_time_minutes: 1,
  },
  images: [],
  videos: [],
  audio: [],
  links: [
    {
      href: 'https://fieldnotes.example/garden/seed-starting',
      text: 'Seed starting guide',
      rel: null,
    },
    {
      href: 'https://fieldnotes.example/garden/planting-calendar.pdf',
      text: '',
      rel: 'nofollow',
    },
  ],
  ld_json: [],
  raw_html_size: 48,
  seo: {
    url: mocks.tab.url,
    fetched_at: 1_791_000_000_000,
    title: { value: 'Starting seeds indoors', length: 22 },
    description: { value: null, length: 0 },
    canonical: null,
    robots: null,
    lang: 'en',
    hreflang: [],
    og: {},
    twitter: {},
    schema_types: [],
    headings: [],
    links: { internal: 2, external: 0 },
    images: { total: 0, missing_alt: 0 },
    word_count: 3,
    sentence_count: 1,
    flesch_reading_ease: null,
    performance: {
      nav_type: null,
      duration_ms: null,
      transfer_size_bytes: null,
      http_status: null,
      redirect_count: null,
    },
  },
};

beforeEach(() => {
  useScrapeStore.getState().setCurrent(capture, mocks.tab.pageKey);
  mocks.copiedText.mockReset();
});
afterEach(() => {
  cleanup();
  useScrapeStore.getState().setCurrent(null);
});

const openLinks = async () => {
  await userEvent.click(screen.getByRole('tab', { name: /Links/ }));
};

describe('ScrapeView link controls', () => {
  it('opens the selected link and copies its exact address through the clipboard boundary', async () => {
    render(<ScrapeView />);
    await openLinks();

    const guide = screen.getByRole('link', { name: /Seed starting guide/ });
    expect(guide.getAttribute('href')).toBe('https://fieldnotes.example/garden/seed-starting');
    expect(guide.getAttribute('target')).toBe('_blank');
    const copyButton = screen.getAllByTitle('Copy URL').at(0);
    if (!copyButton) throw new Error('Expected the guide copy button to exist');
    fireEvent.click(copyButton);
    await waitFor(() =>
      expect(mocks.copiedText).toHaveBeenCalledWith(
        'https://fieldnotes.example/garden/seed-starting',
      ),
    );
    expect(useScrapeStore.getState().current?.links).toHaveLength(2);
  });

  it('removes only the selected href and text pair and updates the visible link count', async () => {
    render(<ScrapeView />);
    await openLinks();
    expect(screen.getByText('2 links')).toBeTruthy();

    const guide = screen.getByRole('link', { name: /Seed starting guide/ });
    fireEvent.click(guide.parentElement?.querySelector('[title="Remove link"]') as HTMLElement);

    expect(useScrapeStore.getState().current?.links).toEqual([
      {
        href: 'https://fieldnotes.example/garden/planting-calendar.pdf',
        text: '',
        rel: 'nofollow',
      },
    ]);
    expect(screen.getByText('1 link')).toBeTruthy();
    expect(screen.queryByText('Seed starting guide')).toBeNull();
    expect(screen.getByRole('link', { name: /planting-calendar.pdf/ })).toBeTruthy();
  });

  it('keeps a blank href draft, adds a valid href with text, and Cancel discards another draft', async () => {
    render(<ScrapeView />);
    await openLinks();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const href = screen.getByPlaceholderText('https://…');
    const text = screen.getByPlaceholderText('anchor text (optional)');

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(useScrapeStore.getState().current?.links).toHaveLength(2);
    expect((href as HTMLInputElement).value).toBe('');

    fireEvent.change(href, {
      target: { value: 'https://fieldnotes.example/garden/hardening-off' },
    });
    fireEvent.change(text, { target: { value: 'Hardening off seedlings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(useScrapeStore.getState().current?.links).toHaveLength(3));
    expect(useScrapeStore.getState().current?.links.at(-1)).toEqual({
      href: 'https://fieldnotes.example/garden/hardening-off',
      text: 'Hardening off seedlings',
      rel: null,
    });
    expect(screen.getByText('3 links')).toBeTruthy();

    const secondDraft = screen.getByPlaceholderText('https://…');
    fireEvent.change(secondDraft, {
      target: { value: 'https://fieldnotes.example/garden/discard-this' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect((screen.getByPlaceholderText('https://…') as HTMLInputElement).value).toBe('');
    expect(useScrapeStore.getState().current?.links).toHaveLength(3);
    expect(useScrapeStore.getState().current?.links.map((link) => link.href)).toEqual([
      'https://fieldnotes.example/garden/seed-starting',
      'https://fieldnotes.example/garden/planting-calendar.pdf',
      'https://fieldnotes.example/garden/hardening-off',
    ]);
  });

  it('adds an href without anchor text and displays the address as its label', async () => {
    render(<ScrapeView />);
    await openLinks();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByPlaceholderText('https://…'), {
      target: { value: 'https://fieldnotes.example/garden/watering' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(useScrapeStore.getState().current?.links).toHaveLength(3));
    expect(useScrapeStore.getState().current?.links.at(-1)).toEqual({
      href: 'https://fieldnotes.example/garden/watering',
      text: '',
      rel: null,
    });
    expect(screen.getAllByRole('link', { name: /watering/ })).toHaveLength(1);
    expect(screen.getByText('3 links')).toBeTruthy();
  });
});
