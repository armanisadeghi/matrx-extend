import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/api/routes/social', () => ({ readPostMediaBlob: transport.read }));
import { StoredMedia } from '@/features/swipe-file/StoredMedia';
beforeEach(() => {
  transport.read.mockResolvedValue(new Blob(['stored content']));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stored-media-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it.each([
  { mime: 'image/heic', role: 'image', selector: 'img', suffix: '.heic' },
  { mime: 'video/mp4', role: 'video', selector: 'video', suffix: '' },
])(
  'exposes the stored file when $mime cannot decode, without claiming the capture was lost',
  async ({ mime, role, selector, suffix }) => {
    const { container, unmount } = render(
      <StoredMedia
        media={{
          file_id: 'captured-asset',
          role,
          mime_type: mime,
          size_bytes: 3200,
          door: '/social/posts/sunrise/media/captured-asset',
        }}
        postId="sunrise"
        organizationId="studio-west"
      />,
    );
    expect(screen.queryByRole('link', { name: 'Download stored file' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open stored file' }));
    await waitFor(() => expect(container.querySelector(selector)).toBeTruthy());
    const player = container.querySelector(selector);
    if (!player) throw new Error('Stored media player did not mount.');
    fireEvent.error(player);
    expect(screen.getByRole('alert').textContent).toBe(
      'Preview unavailable. Download the stored file.',
    );
    const download = screen.getByRole('link', { name: 'Download stored file' });
    expect(download.getAttribute('href')).toBe('blob:stored-media-preview');
    expect(download.getAttribute('download')).toBe(`captured-asset${suffix}`);
    expect(container.querySelector(selector)).toBeNull();
    expect(transport.read).toHaveBeenCalledWith('sunrise', 'captured-asset', 'studio-west');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stored-media-preview');
  },
);
