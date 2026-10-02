import { SiteAccessControl } from '@/components/SiteAccessControl';
import { PrepareTab } from '@/features/showcase/tabs/PrepareTab';
import type { ActiveTabInfo } from '@/hooks/use-active-tab';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeTab: null as ActiveTabInfo | null,
  preparePage: vi.fn(),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => mocks.activeTab,
  isCurrentPageIdentity: (key: string) => key === mocks.activeTab?.pageKey,
  refreshActiveTabIdentity: vi.fn(),
}));
vi.mock('@/lib/data-pattern/page-prep', () => ({
  defaultPagePrepConfig: { dismissBanners: true, expandLoadMore: true, scrollToBottom: true },
  preparePage: mocks.preparePage,
}));

const page = (pageKey = 'page-a'): ActiveTabInfo => ({
  id: 23,
  url: 'https://example.org/a',
  title: 'A',
  documentId: pageKey,
  identityStatus: 'ready',
  identityError: null,
  pageKey,
});

const request = vi.fn();
const reload = vi.fn();

beforeEach(() => {
  mocks.activeTab = page();
  mocks.preparePage.mockReset();
  request.mockReset();
  reload.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { permissions: { request }, tabs: { reload } });
});

it('reloads a stuck Prepare document, permits a fresh action with persistent access still absent, and ignores the late result', async () => {
  let resolveOld!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const report = (duration_ms: number) => ({
    duration_ms,
    banners_dismissed: [],
    load_more_clicks: [],
    scroll_steps: 1,
  });
  mocks.preparePage.mockReturnValueOnce(old).mockResolvedValueOnce(report(28));
  reload.mockImplementation(async () => {
    mocks.activeTab = page('page-b');
  });
  const user = userEvent.setup();
  const view = render(
    <>
      <SiteAccessControl tab={mocks.activeTab as ActiveTabInfo} />
      <PrepareTab />
    </>,
  );
  await user.click(screen.getByRole('button', { name: 'Prepare page' }));
  expect((screen.getByRole('button', { name: 'Preparing…' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.click(screen.getByRole('button', { name: 'Site access' }));
  await user.click(screen.getByRole('button', { name: 'Reload page' }));
  expect(reload).toHaveBeenCalledWith(23);
  view.rerender(
    <>
      <SiteAccessControl tab={mocks.activeTab as ActiveTabInfo} />
      <PrepareTab />
    </>,
  );
  await user.click(screen.getByRole('button', { name: 'Prepare page' }));
  expect(await screen.findByText('Prepared in 28ms')).toBeTruthy();
  await act(async () => {
    resolveOld(report(99));
    await old;
  });
  expect(screen.getByText('Prepared in 28ms')).toBeTruthy();
  expect(screen.queryByText('Prepared in 99ms')).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('offers temporary access independently of persistent grant and reloads only on a separate click', async () => {
  request.mockResolvedValue(true);
  const user = userEvent.setup();
  render(<SiteAccessControl tab={page()} />);
  await user.click(screen.getByRole('button', { name: 'Site access' }));
  expect(screen.getByText(/toolbar/i)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Always allow on this site' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ origins: ['https://example.org/*'] }));
  expect(reload).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Reload page' }));
  expect(reload).toHaveBeenCalledWith(23);
});

it('keeps the temporary route visible after denial', async () => {
  request.mockResolvedValue(false);
  const user = userEvent.setup();
  render(<SiteAccessControl tab={page()} />);
  await user.click(screen.getByRole('button', { name: 'Site access' }));
  await user.click(screen.getByRole('button', { name: 'Always allow on this site' }));
  expect(await screen.findByText(/not granted/i)).toBeTruthy();
  expect(screen.getByText(/toolbar/i)).toBeTruthy();
  expect(reload).not.toHaveBeenCalled();
});

it('refuses to request or reload a page that changed after opening the control', async () => {
  const user = userEvent.setup();
  const view = render(<SiteAccessControl tab={page()} />);
  await user.click(screen.getByRole('button', { name: 'Site access' }));
  view.rerender(<SiteAccessControl tab={page('page-b')} />);
  await user.click(screen.getByRole('button', { name: 'Always allow on this site' }));
  await user.click(screen.getByRole('button', { name: 'Reload page' }));
  expect(request).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
  expect(screen.getByText(/page changed/i)).toBeTruthy();
});

it('explains unsupported APIs and non-web pages without making requests', async () => {
  vi.stubGlobal('chrome', { tabs: { reload } });
  const user = userEvent.setup();
  const view = render(<SiteAccessControl tab={page()} />);
  await user.click(screen.getByRole('button', { name: 'Site access' }));
  await user.click(screen.getByRole('button', { name: 'Always allow on this site' }));
  expect(await screen.findByText(/unavailable/i)).toBeTruthy();
  view.unmount();
  render(<SiteAccessControl tab={{ ...page(), url: 'chrome://settings' }} />);
  await user.click(screen.getByRole('button', { name: 'Site access' }));
  expect(screen.getByText(/web page/i)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
