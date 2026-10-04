import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  copiedText: vi.fn(),
  tab: {
    url: 'https://fieldnotes.test/garden/seed-starting',
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
  images: [
    {
      src: 'https://fieldnotes.test/media/seed-tray.jpg',
      alt: 'Seed tray',
      width: 1200,
      height: 800,
    },
    {
      src: 'https://fieldnotes.test/media/site-mark.svg',
      alt: 'Fieldnotes',
      width: 32,
      height: 32,
    },
    { src: 'https://fieldnotes.test/media/soil-chart.png', alt: null, width: 640, height: 480 },
  ],
  videos: [
    { src: 'https://video.test/watch/seedlings', poster: null, duration: 82 },
    { src: 'https://video.test/watch/watering', poster: null, duration: 46 },
  ],
  audio: [],
  links: [],
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
    links: { internal: 0, external: 0 },
    images: { total: 3, missing_alt: 1 },
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

const openTab = async (label: 'Images' | 'Video') => {
  await userEvent.click(screen.getByRole('tab', { name: new RegExp(label) }));
};

const firstElement = (elements: HTMLElement[], description: string): HTMLElement => {
  const element = elements[0];
  if (!element) throw new Error(`Expected ${description} to exist`);
  return element;
};

describe('ScrapeView media controls', () => {
  it('removes only the selected image and updates the visible image count', async () => {
    render(<ScrapeView />);
    await openTab('Images');
    expect(screen.getByRole('tab', { name: /Images 3/ })).toBeTruthy();
    fireEvent.click(firstElement(screen.getAllByTitle('Remove image'), 'remove image button'));
    expect(useScrapeStore.getState().current?.images.map((image) => image.src)).toEqual([
      'https://fieldnotes.test/media/site-mark.svg',
      'https://fieldnotes.test/media/soil-chart.png',
    ]);
    expect(screen.getByRole('tab', { name: /Images 2/ })).toBeTruthy();
    expect(screen.getAllByTitle('Remove image')).toHaveLength(2);
  });

  it('keeps Images selected while medium, icon, then large images are removed', async () => {
    render(<ScrapeView />);
    await openTab('Images');
    const selected = () =>
      screen.getByRole('tab', { name: /Images/ }).getAttribute('aria-selected');
    const remove = async (src: string) => {
      const image = document.querySelector(`img[src="${src}"]`);
      if (!image) throw new Error(`Image missing for ${src}`);
      const button = image.closest('.group')?.querySelector('button[title="Remove image"]');
      if (!button) throw new Error(`Remove control missing for ${src}`);
      await userEvent.click(button);
    };
    expect(selected()).toBe('true');
    await remove('https://fieldnotes.test/media/soil-chart.png');
    expect(useScrapeStore.getState().current?.images.map((image) => image.src)).toEqual([
      'https://fieldnotes.test/media/seed-tray.jpg',
      'https://fieldnotes.test/media/site-mark.svg',
    ]);
    expect(selected()).toBe('true');
    await remove('https://fieldnotes.test/media/site-mark.svg');
    expect(useScrapeStore.getState().current?.images.map((image) => image.src)).toEqual([
      'https://fieldnotes.test/media/seed-tray.jpg',
    ]);
    expect(selected()).toBe('true');
    await remove('https://fieldnotes.test/media/seed-tray.jpg');
    expect(useScrapeStore.getState().current?.images).toEqual([]);
    expect(selected()).toBe('true');
    expect(screen.getByRole('tab', { name: 'Article' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('keeps a blank image draft for correction, adds a valid image, and Cancel clears another draft', async () => {
    render(<ScrapeView />);
    await openTab('Images');
    fireEvent.click(screen.getByRole('button', { name: 'Add image URL' }));
    const src = screen.getByPlaceholderText('https://…');
    const alt = screen.getByPlaceholderText('alt text (optional)');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(useScrapeStore.getState().current?.images).toHaveLength(3);
    expect((src as HTMLInputElement).value).toBe('');
    fireEvent.change(src, {
      target: { value: 'https://fieldnotes.test/media/germination.jpg' },
    });
    fireEvent.change(alt, { target: { value: 'Germination tray' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(useScrapeStore.getState().current?.images).toHaveLength(4));
    expect(useScrapeStore.getState().current?.images.at(-1)).toMatchObject({
      src: 'https://fieldnotes.test/media/germination.jpg',
      alt: 'Germination tray',
    });
    expect(screen.getByRole('tab', { name: /Images 4/ })).toBeTruthy();
    const draft = screen.getByPlaceholderText('https://…');
    fireEvent.change(draft, {
      target: { value: 'https://fieldnotes.test/media/discard-this.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add image URL' }));
    expect((screen.getByPlaceholderText('https://…') as HTMLInputElement).value).toBe('');
    expect(useScrapeStore.getState().current?.images).toHaveLength(4);
  });

  it('opens and copies the selected video URL, removes only that row, and rejects a blank add', async () => {
    render(<ScrapeView />);
    await openTab('Video');
    const videoLink = screen.getByRole('link', { name: 'https://video.test/watch/seedlings' });
    expect(videoLink.getAttribute('href')).toBe('https://video.test/watch/seedlings');
    fireEvent.click(firstElement(screen.getAllByTitle('Copy video URL'), 'copy video URL button'));
    await waitFor(() =>
      expect(mocks.copiedText).toHaveBeenCalledWith('https://video.test/watch/seedlings'),
    );
    fireEvent.click(firstElement(screen.getAllByTitle('Remove video'), 'remove video button'));
    expect(useScrapeStore.getState().current?.videos.map((video) => video.src)).toEqual([
      'https://video.test/watch/watering',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Add video URL' }));
    const src = screen.getByPlaceholderText('https://…');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(useScrapeStore.getState().current?.videos).toHaveLength(1);
    expect((src as HTMLInputElement).value).toBe('');
    fireEvent.change(src, { target: { value: 'https://video.test/watch/transplanting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(useScrapeStore.getState().current?.videos.map((video) => video.src)).toEqual([
        'https://video.test/watch/watering',
        'https://video.test/watch/transplanting',
      ]),
    );
  });
});
