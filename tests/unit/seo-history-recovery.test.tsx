import { SeoView } from '@/features/seo/SeoView';
import { DbFailureError } from '@/lib/supabase/db-failure';
import { type SeoAuditRow, fetchSeoAuditHistoryForUrl } from '@/lib/supabase/queries';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  eq: vi.fn(),
  tab: { id: null, url: 'https://www.iana.org/domains/reserved', pageKey: null },
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => mocks.tab,
  isCurrentPageIdentity: () => false,
  refreshActiveTabIdentity: vi.fn(),
}));
vi.mock('@/lib/supabase/schemas', () => ({
  extendDb: () => ({
    from: () => ({
      select: () => ({
        eq: mocks.eq,
      }),
    }),
  }),
}));
vi.mock('@/lib/telemetry/external-reporting', () => ({
  mayReportExternalTelemetry: async () => false,
}));
vi.mock('@/lib/debug/log', () => ({ log: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/components/CopyMenu', () => ({ CopyMenu: () => null }));
vi.mock('@/features/seo/AiRecommendations', () => ({ AiRecommendations: () => null }));
vi.mock('@/features/seo/SeoVerdict', () => ({ SeoVerdict: () => null }));

// The PostgREST refusal from EXT-D-0198's recorded diagnostic.
const refusal = {
  code: '42501',
  message: 'permission denied for table wbx_seo_audit',
  details: null,
  hint: null,
};
const saved = {
  id: '44444444-4444-4444-8444-444444444444',
  url: 'https://www.iana.org/domains/reserved',
  audited_at: '2026-10-10T16:00:00Z',
  signals: null,
  recommendations: null,
  flesch_reading_ease: null,
  word_count: null,
  notes: null,
} satisfies SeoAuditRow;

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.eq.mockReset().mockImplementation(() => ({ order: () => ({ limit: mocks.read }) }));
});
afterEach(cleanup);

it('rejects a real history query refusal instead of returning successful empty history', async () => {
  mocks.read.mockResolvedValue({ data: null, error: refusal });
  await expect(fetchSeoAuditHistoryForUrl(saved.url)).rejects.toMatchObject({
    name: 'DbFailureError',
    kind: 'refused',
    code: '42501',
  });
});

it('rejects a missing history table instead of reporting no saved audits', async () => {
  mocks.read.mockResolvedValue({
    data: null,
    error: { code: '42P01', message: 'relation extend.wbx_seo_audit does not exist' },
  });
  await expect(fetchSeoAuditHistoryForUrl(saved.url)).rejects.toBeInstanceOf(DbFailureError);
});

it('keeps history reachable during loading and after a genuinely empty read', async () => {
  let finish!: (value: { data: []; error: null }) => void;
  mocks.read.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<SeoView />);
  await userEvent.click(screen.getByRole('button', { name: 'Saved audits for this URL' }));
  expect(screen.getByRole('status').textContent).toContain('Loading saved audits');
  await act(async () => finish({ data: [], error: null }));
  expect(screen.getByText('No saved audits for this URL.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Saved audits for this URL' })).toBeTruthy();
});

it('shows query failure and retries through SeoView to a fresh successful history read', async () => {
  mocks.read.mockResolvedValueOnce({ data: null, error: refusal });
  render(<SeoView />);
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Saved audits could not load'),
  );
  expect(screen.queryByText('No saved audits for this URL.')).toBeNull();
  const history = screen.getByRole('button', { name: 'Saved audits for this URL' });
  await userEvent.click(history);
  await userEvent.click(history);
  expect(screen.getByRole('alert')).toBeTruthy();
  mocks.read.mockResolvedValueOnce({ data: [saved], error: null });
  await userEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  await waitFor(() =>
    expect(document.querySelector(`button[data-audit-id="${saved.id}"]`)).toBeTruthy(),
  );
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.eq).toHaveBeenNthCalledWith(2, 'url', saved.url);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('First saved audit')).toBeTruthy();
});

it('ignores a delayed history failure for a URL the user has left', async () => {
  let finish!: (value: { data: null; error: typeof refusal }) => void;
  mocks.read.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<SeoView />);
  const previousUrl = mocks.tab.url;
  mocks.tab.url = 'https://www.iana.org/help/example-domains';
  mocks.read.mockResolvedValueOnce({ data: [], error: null });
  view.rerender(<SeoView />);
  await waitFor(() => expect(mocks.eq).toHaveBeenCalledWith('url', mocks.tab.url));
  await act(async () => finish({ data: null, error: refusal }));
  await userEvent.click(screen.getByRole('button', { name: 'Saved audits for this URL' }));
  expect(screen.getByText('No saved audits for this URL.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  mocks.tab.url = previousUrl;
});
