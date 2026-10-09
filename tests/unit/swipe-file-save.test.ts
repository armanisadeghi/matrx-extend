import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  ingestPost: vi.fn(),
  createCollection: vi.fn(),
  addPostToCollection: vi.fn(),
  isPostInCollection: vi.fn(),
  getLast: vi.fn(),
  setLast: vi.fn(),
}));
vi.mock('@/lib/api/routes/social', () => ({
  ingestPost: m.ingestPost,
  createCollection: m.createCollection,
  addPostToCollection: m.addPostToCollection,
}));
vi.mock('@/lib/swipe-file/store', () => ({
  isPostInCollection: m.isPostInCollection,
  getLastCollectionId: m.getLast,
  setLastCollectionId: m.setLast,
}));

import { saveToSwipeFile } from '@/lib/swipe-file/save';

const URL_OK = 'https://www.tiktok.com/@u/video/7300000000000000000';
const post = (trace: object = {}) => ({
  ok: true,
  result: { post_id: 'p1', title: 'Hook', trace },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.getLast.mockResolvedValue('c-last');
  m.isPostInCollection.mockResolvedValue(false);
  m.addPostToCollection.mockResolvedValue({ ok: true, data: { saved: true } });
});

describe('saveToSwipeFile', () => {
  it('saves into the last-used collection by default and remembers it', async () => {
    m.ingestPost.mockResolvedValue(post());
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: null }, () => {});
    expect(o).toMatchObject({
      status: 'saved',
      collectionId: 'c-last',
      postId: 'p1',
      notice: null,
    });
    expect(m.addPostToCollection).toHaveBeenCalledWith('c-last', 'p1');
    expect(m.setLast).toHaveBeenCalledWith('c-last');
  });

  it('says already saved and does not add twice', async () => {
    m.ingestPost.mockResolvedValue(post());
    m.isPostInCollection.mockResolvedValue(true);
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(o.status).toBe('already_saved');
    expect(m.addPostToCollection).not.toHaveBeenCalled();
  });

  it('shows a backup notice without exposing provider details', async () => {
    m.ingestPost.mockResolvedValue(
      post({ provider: 'private-vendor', fallback_reason: 'primary timed out' }),
    );
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(o).toMatchObject({ status: 'saved', notice: 'Fetched from a backup source' });
    expect((o as { notice: string }).notice).not.toContain('private-vendor');
    expect((o as { notice: string }).notice).not.toContain('primary timed out');
  });

  it('creates a new collection after the post is fetched', async () => {
    m.ingestPost.mockResolvedValue(post());
    m.createCollection.mockResolvedValue({
      ok: true,
      data: { collection_id: 'new1', name: 'Hooks' },
    });
    const o = await saveToSwipeFile(
      { url: URL_OK, collectionId: null, newCollectionName: ' Hooks ' },
      () => {},
    );
    expect(m.createCollection).toHaveBeenCalledWith('Hooks');
    expect(o).toMatchObject({ status: 'saved', collectionId: 'new1' });
  });

  it('fails with the server reason, never saved', async () => {
    m.ingestPost.mockResolvedValue({ ok: false, reason: 'That platform is not supported.' });
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(o).toEqual({ status: 'failed', reason: 'That platform is not supported.' });
    expect(m.addPostToCollection).not.toHaveBeenCalled();
  });

  it('refuses a non-post URL before any network call', async () => {
    const o = await saveToSwipeFile(
      { url: 'https://www.tiktok.com/@u', collectionId: 'c1' },
      () => {},
    );
    expect(o.status).toBe('failed');
    expect(m.ingestPost).not.toHaveBeenCalled();
  });

  it('reports a failed add honestly', async () => {
    m.ingestPost.mockResolvedValue(post());
    m.addPostToCollection.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' });
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(o.status).toBe('failed');
    expect(m.setLast).not.toHaveBeenCalled();
  });
});
