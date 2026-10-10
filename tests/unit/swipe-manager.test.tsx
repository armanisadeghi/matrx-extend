import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const network = vi.hoisted(() => ({
  collections: vi.fn(),
  memberships: vi.fn(),
  post: vi.fn(),
  summary: vi.fn(),
  media: vi.fn(),
  coverage: vi.fn(),
  save: vi.fn(),
  notes: vi.fn(),
  remove: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock('@/lib/swipe-file/save', () => ({ saveToSwipeFile: network.save }));
vi.mock('@/lib/swipe-file/library', () => ({
  readSwipeCollections: network.collections,
  readSwipeMemberships: network.memberships,
  readSwipePost: network.post,
  readSwipePostSummary: network.summary,
  updateSwipeNotes: network.notes,
  removeSwipeMembership: network.remove,
  updateSwipeCollection: vi.fn(),
}));
vi.mock('@/lib/api/routes/social', () => ({
  getPostMedia: network.media,
  getPostMediaCoverage: network.coverage,
  addPostToCollection: vi.fn(),
  createCollection: vi.fn(),
  readPostMediaBlob: vi.fn(),
}));
vi.mock('@/lib/swipe-file/receipt', () => ({ readSwipeReceipt: network.receipt }));
vi.mock('@/lib/swipe-file/navigation', () => ({
  swipePostWebUrl: (id: string, org: string) =>
    `https://aimatrx.com/projects?panels=social_post:${id}:o-${org}`,
}));
import { SwipeFileView } from '@/features/swipe-file/SwipeFileView';
import { useSwipeFileStore } from '@/state/swipe-file';
const membership = {
  id: 'landscape-membership',
  source_id: 'landscapes',
  target_id: 'sunrise',
  target_type: 'social_post',
  organization_id: 'studio-west',
  metadata: { note: 'Opening scene', tags: ['nature'] },
  created_at: '2026-10-10T15:00:00Z',
};
const post = {
  id: 'sunrise',
  organization_id: 'shared-library',
  platform: 'instagram',
  url: 'https://instagram.com/p/sunrise',
  title: 'Mountain sunrise',
  caption: 'Morning light over the ridge',
  format: 'video',
  posted_at: null,
  hashtags: ['sunrise'],
  mentions: [],
  profile_id: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  useSwipeFileStore.setState({
    selection: { postId: 'sunrise', collectionId: 'landscapes', organizationId: 'studio-west' },
  });
  network.collections.mockResolvedValue([
    { id: 'landscapes', name: 'Landscape ideas', organization_id: 'studio-west', deleted_at: null },
  ]);
  network.memberships.mockResolvedValue([membership]);
  network.post.mockResolvedValue({
    post,
    transcripts: [
      { id: 'voiceover', text: 'A new day begins', language: 'en', source: 'provider' },
    ],
  });
  network.summary.mockResolvedValue(post);
  network.media.mockResolvedValue([
    {
      file_id: 'stored-clip',
      role: 'video',
      mime_type: 'video/mp4',
      size_bytes: 1024,
      door: '/social/posts/sunrise/media/stored-clip',
    },
  ]);
  network.coverage.mockResolvedValue(null);
  network.receipt.mockResolvedValue({ mediaNotes: ['Second clip could not be downloaded'] });
  network.notes.mockResolvedValue(undefined);
});
afterEach(cleanup);
it('opens canonical content and saves editable membership without writing provider text or using the shared post organization', async () => {
  render(<SwipeFileView />);
  expect(await screen.findByText('Morning light over the ridge')).toBeTruthy();
  expect(await screen.findByText('1 stored file')).toBeTruthy();
  expect(screen.getByText('Coverage unverified')).toBeTruthy();
  expect(screen.getByText('Second clip could not be downloaded')).toBeTruthy();
  expect(network.media).toHaveBeenCalledWith('sunrise', 'studio-west');
  expect(screen.getByRole('link', { name: 'Open in Matrx' }).getAttribute('href')).toContain(
    'o-studio-west',
  );
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Use the opening scene' } });
  fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'nature, video' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(network.notes).toHaveBeenCalledWith(membership, 'Use the opening scene', [
      'nature',
      'video',
    ]),
  );
  expect(await screen.findByText('Changes saved')).toBeTruthy();
});
it('a media read failure stays unknown instead of displaying a successful empty capture', async () => {
  network.media.mockRejectedValue(new Error('Stored media is unavailable'));
  render(<SwipeFileView />);
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Stored media is unavailable',
  );
  expect(screen.getByText('Media status unavailable')).toBeTruthy();
  expect(screen.queryByText('0 stored files')).toBeNull();
  expect(screen.queryByText('No stored files')).toBeNull();
  expect(screen.getByText('Morning light over the ridge')).toBeTruthy();
});

it('shows current canonical incomplete carousel coverage instead of trusting an older local receipt', async () => {
  network.coverage.mockResolvedValue({
    expected_items: 7,
    observed_items: 7,
    stored_items: 1,
    missing_items: 6,
    status: 'partial',
  });
  render(<SwipeFileView />);
  expect(await screen.findByText('1 of 7 media items stored')).toBeTruthy();
  expect(screen.queryByText('All reported media stored')).toBeNull();
  expect(network.coverage).toHaveBeenCalledWith('sunrise', 'studio-west');
});

it('repairs saved carousel through the canonical save path and reloads its current files', async () => {
  network.save.mockResolvedValue({ status: 'already_saved' });
  render(<SwipeFileView />);
  await screen.findByText('Morning light over the ridge');
  network.media.mockResolvedValue([
    {
      file_id: 'opening',
      role: 'image',
      mime_type: 'image/jpeg',
      size_bytes: 1024,
      door: '/opening',
    },
    {
      file_id: 'closing',
      role: 'image',
      mime_type: 'image/jpeg',
      size_bytes: 2048,
      door: '/closing',
    },
  ]);
  network.coverage.mockResolvedValue({
    expected_items: 2,
    observed_items: 2,
    stored_items: 2,
    missing_items: 0,
    status: 'complete',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh capture' }));
  await waitFor(() =>
    expect(network.save).toHaveBeenCalledWith(
      { url: post.url, collectionId: 'landscapes' },
      expect.any(Function),
    ),
  );
  expect(await screen.findByText('2 stored files')).toBeTruthy();
  expect(screen.getByText('All reported media stored')).toBeTruthy();
});
