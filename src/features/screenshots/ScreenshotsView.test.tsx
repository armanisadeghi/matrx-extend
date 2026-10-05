import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  fetch: vi.fn(),
  createTab: vi.fn(),
  share: vi.fn(),
  capture: vi.fn(),
}));
vi.mock('@/config/backend', () => ({
  useBackendConfig: () => ({ url: 'https://server.example.com' }),
}));
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({ id: 1, url: 'https://example.com/', title: 'Example' }),
}));
vi.mock('@/lib/api/routes/files', () => ({ downloadFileBytes: mocks.download }));
vi.mock('@/lib/supabase/queries', () => ({
  fetchScreenshotsForUrl: mocks.fetch,
  deleteScreenshot: vi.fn(),
}));
vi.mock('@/lib/messaging/native', () => ({ on: () => () => {}, broadcast: vi.fn() }));
vi.mock('@/lib/tools/handlers/read', () => ({ take_screenshot: { run: mocks.capture } }));
vi.mock('@/lib/screenshot/document', () => ({
  readScreenshotDocument: async () => ({
    tabId: 1,
    windowId: 1,
    documentId: 'doc',
    url: 'https://example.com/',
  }),
  assertScreenshotDocument: async () => {},
}));
vi.mock('@/lib/files/media-client', () => ({
  getScreenshotMediaClient: async () => ({ shareableUrl: mocks.share }),
}));
vi.mock('./ScreenshotShareLinks', () => ({ ScreenshotShareLinks: () => null }));
import { ScreenshotsView } from './ScreenshotsView';

beforeEach(() => {
  mocks.fetch.mockReset().mockResolvedValue([
    {
      id: 'screenshot',
      file_id: 'file-123',
      source: 'user',
      page_title: 'Test image',
      width: 1200,
      height: 6000,
      captured_at: '2026-10-05T10:00:00Z',
    },
  ]);
  mocks.download
    .mockReset()
    .mockResolvedValue({ blob: new Blob(['image'], { type: 'image/png' }) });
  mocks.createTab.mockReset();
  mocks.capture
    .mockReset()
    .mockResolvedValue({ ok: true, file_id: 'file-123', screenshot_id: 'screenshot' });
  mocks.share.mockReset().mockResolvedValue('https://example.com/s/public-token');
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('chrome', { tabs: { create: mocks.createTab } });
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:loaded-image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Screenshot gallery viewing and canonical sharing', () => {
  it('shows cropping when the persisted cloud capture reaches its tile cap', async () => {
    mocks.capture.mockResolvedValue({
      ok: true,
      file_id: 'file-123',
      screenshot_id: 'screenshot',
      capture: { truncated: true },
    });
    render(<ScreenshotsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Full page' }));
    expect(await screen.findByText(/bottom is cropped/)).toBeTruthy();
  });
  it.each(['Visible', 'Full page'])(
    'preserves user image resolution and routes %s mode correctly',
    async (label) => {
      render(<ScreenshotsView />);
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(mocks.capture).toHaveBeenCalled());
      expect(mocks.capture.mock.calls[0]?.[0]).toMatchObject({
        mode: label === 'Visible' ? 'visible' : 'full_page',
        format: 'png',
        max_dimension: 0,
      });
    },
  );
  it('opens the full loaded bytes locally with no second download or website tab', async () => {
    render(<ScreenshotsView />);
    const thumbnail = await screen.findByRole('button', { name: 'View screenshot' });
    await waitFor(() =>
      expect(screen.getByAltText('Test image').getAttribute('src')).toBe('blob:loaded-image'),
    );
    fireEvent.click(thumbnail);
    const viewer = await screen.findByRole('dialog');
    expect(viewer.querySelector('img')?.getAttribute('src')).toBe('blob:loaded-image');
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.createTab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(thumbnail);
    expect((await screen.findByRole('dialog')).querySelector('img')?.getAttribute('src')).toBe(
      'blob:loaded-image',
    );
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it('uses the real shared share body and requests a canonical public URL only on click', async () => {
    render(<ScreenshotsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Share screenshot' }));
    expect(await screen.findByText('Copy public link')).toBeTruthy();
    expect(mocks.share).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Copy public link'));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://example.com/s/public-token',
      ),
    );
    expect(mocks.share).toHaveBeenCalledWith({ file_id: 'file-123', mime_type: 'image/png' });
    expect(await screen.findByText('Public link copied')).toBeTruthy();
  });
  it('keeps clipboard failure visible in the canonical share body', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Denied'));
    render(<ScreenshotsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Share screenshot' }));
    fireEvent.click(await screen.findByText('Copy public link'));
    expect((await screen.findAllByText('Could not copy link')).length).toBeGreaterThan(0);
  });
});
