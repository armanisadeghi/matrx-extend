import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  error: null as null | {
    class: 'no-receiver' | 'restricted-url';
    title: string;
    description: string;
    rawMessage: string | null;
    url: string | null;
    tabId: number | null;
    actions: ('reload-tab' | 'try-again')[];
    recoverable: boolean;
    at: string;
  },
  captureActiveTab: vi.fn(),
  reloadActiveTab: vi.fn(),
  clearError: vi.fn(),
  edited: false,
  tab: {
    url: 'https://fieldnotes.test/garden/seed-starting',
    title: 'Starting seeds indoors',
    id: 7,
    documentId: 'seed-page',
    identityStatus: 'ready' as const,
    identityError: null,
    pageKey: 'seed-page' as string | null,
  },
}));

vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => mocks.tab,
  isCurrentPageIdentity: (key: string | null) => Boolean(key),
  refreshActiveTabIdentity: vi.fn(),
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
vi.mock('@/hooks/use-scrape', () => ({
  useScrape: () => ({
    current: null,
    loading: false,
    activeMode: null,
    progress: null,
    error: mocks.error,
    edited: mocks.edited,
    captureActiveTab: mocks.captureActiveTab,
    reloadActiveTab: mocks.reloadActiveTab,
    clearError: mocks.clearError,
    save: vi.fn(),
    markSaved: vi.fn(),
    markUnsaved: vi.fn(),
    launchDiagnose: vi.fn(),
  }),
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => 'org-seed-garden',
  onActiveOrganizationChange: () => () => undefined,
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

import { useAuthStore } from '@/state/auth';
import { ScrapeView } from './ScrapeView';

const recoverableError = () => ({
  class: 'no-receiver' as const,
  title: 'Page needs a refresh',
  description: "We couldn't reach the page's helper script.",
  rawMessage: 'Could not establish connection',
  url: mocks.tab.url,
  tabId: 7,
  actions: ['reload-tab', 'try-again'] as ('reload-tab' | 'try-again')[],
  recoverable: true,
  at: '2026-10-04T12:00:00.000Z',
});

beforeEach(() => {
  mocks.error = recoverableError();
  mocks.captureActiveTab.mockReset();
  mocks.reloadActiveTab.mockReset();
  mocks.clearError.mockReset();
  mocks.edited = false;
  useAuthStore.getState().setUser(null);
  useAuthStore.getState().setIsAdmin(false);
});
afterEach(() => cleanup());

describe('ScrapeView capture error recovery', () => {
  it('requires discard confirmation before deep capture after local edits', async () => {
    mocks.error = null;
    mocks.edited = true;
    render(<ScrapeView />);

    await userEvent.click(screen.getByRole('button', { name: 'Scroll & capture' }));
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved edits?' })).toBeTruthy();
    expect(mocks.captureActiveTab).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mocks.captureActiveTab).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Scroll & capture' }));
    await userEvent.click(screen.getByRole('button', { name: 'Re-capture' }));
    expect(mocks.captureActiveTab).toHaveBeenCalledExactlyOnceWith({ mode: 'deep' });
  });

  it('reloads the active tab when Reload page is selected', async () => {
    render(<ScrapeView />);

    await userEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(mocks.reloadActiveTab).toHaveBeenCalledTimes(1);
  });

  it('retries with the previously selected deep mode when activeMode is empty', async () => {
    render(<ScrapeView />);

    await userEvent.click(screen.getByRole('button', { name: 'Scroll & capture' }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.captureActiveTab).toHaveBeenLastCalledWith({ mode: 'deep' });
  });

  it('clears the error when Dismiss is selected', () => {
    render(<ScrapeView />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(mocks.clearError).toHaveBeenCalledTimes(1);
  });

  it('offers only dismissal for nonrecoverable errors with no recovery actions', () => {
    mocks.error = {
      ...recoverableError(),
      class: 'restricted-url',
      title: "This page can't be captured",
      actions: [],
      recoverable: false,
    };
    render(<ScrapeView />);

    expect(screen.getByText("This page can't be captured")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('renders structured error details only when the client auth store marks the user admin', () => {
    useAuthStore.getState().setIsAdmin(true);
    const { unmount } = render(<ScrapeView />);
    expect(screen.getByText('Diagnostics (admin)')).toBeTruthy();
    expect(screen.getByText(/Could not establish connection/)).toBeTruthy();
    unmount();

    useAuthStore.getState().setIsAdmin(false);
    render(<ScrapeView />);
    expect(screen.queryByText('Diagnostics (admin)')).toBeNull();
    expect(screen.queryByText(/Could not establish connection/)).toBeNull();
  });
});
