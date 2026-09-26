/**
 * SOURCE-CONVERGENCE §1 rule 6 on the Scrape panel: a web page whose content
 * has not landed reads "Not yet a Source" WITH the action that makes it one
 * (Capture, then Save); a landed page reads "This page is a Source"; a failed
 * check, a signed-out panel and a page that cannot be a Source never claim
 * either. Real ScrapeView; the scrape hook and recognition are faked.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  url: 'https://docs.example.com/guide',
  recognition: {
    capturedAt: null as string | null,
    capturedId: null as string | null,
    loading: false,
    checkFailed: false,
  },
  current: null as unknown,
  captureActiveTab: vi.fn(async () => undefined),
  save: vi.fn(async () => null),
}));

vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ url: state.url, title: 'Guide', id: 7 }),
}));
vi.mock('@/hooks/use-page-recognition', () => ({ usePageRecognition: () => state.recognition }));
vi.mock('@/hooks/use-scrape', () => ({
  useScrape: () => ({
    current: state.current,
    loading: false,
    activeMode: null,
    progress: null,
    error: null,
    edited: false,
    captureActiveTab: state.captureActiveTab,
    reloadActiveTab: vi.fn(),
    clearError: vi.fn(),
    save: state.save,
    launchDiagnose: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-page-scroll-sync', () => ({ usePageScrollSync: () => undefined }));
vi.mock('@/components/AddToProjectButton', () => ({ AddToProjectButton: () => null }));
vi.mock('@/components/MarkdownView', () => ({ MarkdownView: () => null }));
vi.mock('@/components/CopyMenu', () => ({ CopyMenu: () => null, CopyButton: () => null }));
vi.mock('@/features/scrape/DiagnoseCard', () => ({
  DiagnoseCard: () => null,
  DiagnoseLauncher: () => null,
}));
vi.mock('@/features/scrape/UnsavedCapturesCard', () => ({ UnsavedCapturesCard: () => null }));
vi.mock('@/features/seo/SeoDetails', () => ({ SeoDetails: () => null }));

import { ScrapeView } from '@/features/scrape/ScrapeView';
import { useAuthStore } from '@/state/auth';

const soup = {
  url: 'https://docs.example.com/guide',
  capturedAt: 1,
  metadata: { title: 'Guide' },
  article: {
    extractor: 'defuddle',
    content_markdown: '# Guide',
    content_html_safe: '<h1>Guide</h1>',
  },
  images: [],
  videos: [],
  audio: [],
  links: [],
  ld_json: [],
  seo: {},
};

beforeEach(() => {
  state.url = 'https://docs.example.com/guide';
  state.recognition = { capturedAt: null, capturedId: null, loading: false, checkFailed: false };
  state.current = null;
  state.captureActiveTab.mockClear();
  state.save.mockClear();
  useAuthStore.setState({ user: { id: 'u1' } as never });
  Object.assign(chrome, { tabs: { create: vi.fn(), query: vi.fn(async () => []) } });
});
afterEach(cleanup);

const banner = () => screen.queryByTestId('not-yet-a-source');

describe('Scrape panel names a page by whether it is a Source', () => {
  it('uncaptured page: "Not yet a Source" with Capture, which captures', () => {
    render(<ScrapeView />);
    expect(banner()?.textContent).toMatch(/Not yet a Source — capture this page, then Save/);
    const inBanner = banner()?.querySelector('button') as HTMLButtonElement;
    expect(inBanner.textContent).toBe('Capture');
    expect(inBanner.disabled).toBe(false);
    fireEvent.click(inBanner);
    expect(state.captureActiveTab).toHaveBeenCalledWith({ mode: 'fast' });
  });

  it('captured but not saved: the banner action is Save, and it saves', () => {
    state.current = soup;
    render(<ScrapeView />);
    const inBanner = banner()?.querySelector('button') as HTMLButtonElement;
    expect(banner()?.textContent).toMatch(/Not yet a Source — Save to keep its content/);
    expect(inBanner.textContent).toBe('Save');
    fireEvent.click(inBanner);
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it('a landed page reads "This page is a Source", never "not yet"', () => {
    state.recognition = {
      ...state.recognition,
      capturedAt: '2026-09-26T10:00:00Z',
      capturedId: 'src-1',
    };
    render(<ScrapeView />);
    expect(screen.getByText(/This page is a Source · saved/)).toBeTruthy();
    expect(banner()).toBeNull();
  });

  it('a failed check says it could not check, never "not yet a Source"', () => {
    state.recognition = { ...state.recognition, checkFailed: true };
    render(<ScrapeView />);
    expect(screen.getByText(/Couldn.t check whether you saved this page/)).toBeTruthy();
    expect(banner()).toBeNull();
  });

  it('while the check is running, nothing is claimed', () => {
    state.recognition = { ...state.recognition, loading: true };
    render(<ScrapeView />);
    expect(banner()).toBeNull();
  });

  it('signed out, or a page that cannot be a Source: no claim', () => {
    useAuthStore.setState({ user: null });
    render(<ScrapeView />);
    expect(banner()).toBeNull();
    cleanup();
    useAuthStore.setState({ user: { id: 'u1' } as never });
    state.url = 'chrome://extensions';
    render(<ScrapeView />);
    expect(banner()).toBeNull();
  });
});
