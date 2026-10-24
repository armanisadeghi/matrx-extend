import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  ingestPost: vi.fn(),
  createCollection: vi.fn(),
  addPostToCollection: vi.fn(),
  isPostInCollection: vi.fn(),
  getLast: vi.fn(),
  getCollectionOrg: vi.fn(),
  activeOrg: vi.fn(),
  setLast: vi.fn(),
  record: vi.fn(),
  appConfig: vi.fn(),
}));
vi.mock('@/lib/telemetry/client-error', () => ({ recordClientError: m.record }));
vi.mock('@/lib/config', () => ({ appConfig: m.appConfig }));
vi.mock('@/lib/api/routes/social', () => ({
  ingestPost: m.ingestPost,
  createCollection: m.createCollection,
  addPostToCollection: m.addPostToCollection,
}));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId: m.activeOrg }));
vi.mock('@/lib/swipe-file/store', () => ({
  getCollectionOrganizationId: m.getCollectionOrg,
  isPostInCollection: m.isPostInCollection,
  getLastCollectionId: m.getLast,
  setLastCollectionId: m.setLast,
}));

import { saveToSwipeFile } from '@/lib/swipe-file/save';

const URL_OK = 'https://www.tiktok.com/@u/video/7300000000000000000';
const post = (trace: object = {}) => ({
  ok: true,
  result: {
    post_id: 'p1',
    title: 'Hook',
    trace,
    media: [],
    transcript: { status: 'available', notes: [] },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.getLast.mockResolvedValue('c-last');
  m.activeOrg.mockResolvedValue('org-start');
  m.getCollectionOrg.mockResolvedValue('org-collection');
  m.isPostInCollection.mockResolvedValue(false);
  m.addPostToCollection.mockResolvedValue({ ok: true, data: { saved: true } });
  m.record.mockResolvedValue('err-row-1');
  m.appConfig.mockReturnValue(3000);
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
    expect(m.addPostToCollection).toHaveBeenCalledWith('c-last', 'p1', 'org-collection');
    expect(m.setLast).toHaveBeenCalledWith('c-last', 'org-collection');
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
    expect(m.createCollection).toHaveBeenCalledWith('Hooks', 'org-start');
    expect(o).toMatchObject({ status: 'saved', collectionId: 'new1' });
  });

  it('fails with the server reason, the step, and a recorded reference, never saved', async () => {
    m.ingestPost.mockResolvedValue({
      ok: false,
      reason: 'That platform is not supported.',
      serverCode: 'unsupported_platform',
      requestId: 'req-42',
    });
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(o).toEqual({
      status: 'failed',
      reason: 'That platform is not supported.',
      detail: {
        step: 'Reading this TikTok video',
        serverCode: 'unsupported_platform',
        requestId: 'req-42',
        reference: 'err-row-1',
      },
    });
    // The record joins the server's own row by request id, in the save's organization.
    expect(m.record).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: 'social',
        code: 'unsupported_platform',
        requestId: 'req-42',
        organizationId: 'org-collection',
      }),
    );
    expect(m.addPostToCollection).not.toHaveBeenCalled();
  });

  it('still explains itself when the error log cannot be reached', async () => {
    m.ingestPost.mockResolvedValue({ ok: false, reason: 'Busy.', status: 503 });
    m.record.mockRejectedValue(new Error('offline'));
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(o.status === 'failed' && o.detail).toMatchObject({
      status: 503,
      referenceMissing: 'The error log could not be reached',
    });
  });

  it('refuses a non-post URL before any network call', async () => {
    const o = await saveToSwipeFile(
      { url: 'https://www.tiktok.com/@u', collectionId: 'c1' },
      () => {},
    );
    expect(o.status).toBe('failed');
    expect(m.ingestPost).not.toHaveBeenCalled();
  });

  it('a failed add after creating a collection hands back that collection for the retry', async () => {
    m.ingestPost.mockResolvedValue(post());
    m.createCollection.mockResolvedValue({
      ok: true,
      data: { collection_id: 'new1', name: 'Hooks' },
    });
    m.addPostToCollection.mockResolvedValue({ ok: false, status: 500, error: 'boom' });
    const o = await saveToSwipeFile(
      { url: URL_OK, collectionId: null, newCollectionName: 'Hooks' },
      () => {},
    );
    expect(o.status === 'failed' && o.detail?.collectionId).toBe('new1');
  });

  it('a slow error log never holds up the failure the person is waiting on', async () => {
    vi.useFakeTimers();
    try {
      m.ingestPost.mockResolvedValue({ ok: false, reason: 'Busy.', status: 503 });
      m.record.mockReturnValue(new Promise(() => {}));
      const pending = saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
      await vi.advanceTimersByTimeAsync(3000);
      const o = await pending;
      expect(o.status === 'failed' && o.detail?.referenceMissing).toBe(
        'The error log could not be reached',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('an expired sign-in is the person to fix, so it is not recorded as our error', async () => {
    m.ingestPost.mockResolvedValue({ ok: false, reason: 'Sign in again.', status: 401 });
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(o.status).toBe('failed');
    expect(m.record).not.toHaveBeenCalled();
    expect(m.appConfig).not.toHaveBeenCalled();
  });

  it('uses the counted configured wait and returns at its exact deadline', async () => {
    vi.useFakeTimers();
    try {
      m.ingestPost.mockResolvedValue({ ok: false, reason: 'Busy.', status: 503 });
      m.record.mockReturnValue(new Promise(() => {}));
      m.appConfig.mockReturnValue(17);
      const pending = saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(16);
      expect(settled).toBe(false);
      expect(m.appConfig).toHaveBeenCalledExactlyOnceWith('swipe_error_record_wait_ms');
      expect(m.record).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Busy.') }),
      );

      await vi.advanceTimersByTimeAsync(1);
      const outcome = await pending;
      expect(outcome).toMatchObject({
        status: 'failed',
        reason: 'Busy.',
        detail: { referenceMissing: 'The error log could not be reached' },
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 31])(
    'rejects invalid configured wait %s without starting diagnostics',
    async (waitMs) => {
      vi.useFakeTimers();
      try {
        m.ingestPost.mockResolvedValue({ ok: false, reason: 'Busy.', status: 503 });
        m.appConfig.mockReturnValue(waitMs);
        const outcome = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
        expect(outcome).toMatchObject({
          status: 'failed',
          reason: 'Busy.',
          detail: { referenceMissing: 'The error log could not be reached' },
        });
        expect(m.appConfig).toHaveBeenCalledExactlyOnceWith('swipe_error_record_wait_ms');
        expect(m.record).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('does not read recording configuration for a successful save', async () => {
    m.ingestPost.mockResolvedValue(post());
    const outcome = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(outcome.status).toBe('saved');
    expect(m.appConfig).not.toHaveBeenCalled();
  });

  it('reports a failed add honestly', async () => {
    m.ingestPost.mockResolvedValue(post());
    m.addPostToCollection.mockResolvedValue({ ok: false, status: 403, error: 'forbidden' });
    const o = await saveToSwipeFile({ url: URL_OK, collectionId: 'c1' }, () => {});
    expect(o.status === 'failed' && o.detail).toMatchObject({
      step: 'Adding to the collection',
      status: 403,
      reference: 'err-row-1',
    });
    expect(m.setLast).not.toHaveBeenCalled();
  });
});

it('preserves media/transcript warnings and pins destination organization across a mid-save switch', async () => {
  m.ingestPost.mockImplementation(async () => {
    m.activeOrg.mockResolvedValue('org-switched');
    return {
      ok: true,
      result: {
        post_id: 'partial-post',
        media: [],
        media_notes: ['video: could not be downloaded'],
        transcript: { status: 'none', notes: ['No speech found'] },
      },
    };
  });
  const outcome = await saveToSwipeFile({ url: URL_OK, collectionId: 'destination' }, () => {});
  expect(outcome).toMatchObject({
    status: 'saved',
    receipt: { organizationId: 'org-collection', transcript: { status: 'none' } },
  });
  expect(outcome.status !== 'failed' && outcome.notice).toContain(
    'The video could not be downloaded',
  );
  expect(m.ingestPost.mock.calls[0]?.[3]).toBe('org-collection');
  expect(m.addPostToCollection).toHaveBeenCalledWith(
    'destination',
    'partial-post',
    'org-collection',
  );
});

it('preserves incomplete carousel coverage through save and receipt persistence', async () => {
  m.ingestPost.mockResolvedValue({
    ok: true,
    result: {
      post_id: 'spain-carousel',
      media: [],
      transcript: { status: 'available', notes: [] },
      media_coverage: {
        expected_items: 7,
        observed_items: 7,
        stored_items: 1,
        missing_items: 6,
        status: 'partial',
      },
    },
  });
  const saved = await saveToSwipeFile({ url: URL_OK, collectionId: 'destination' }, () => {});
  expect(saved).toMatchObject({
    status: 'saved',
    receipt: { coverage: { expected_items: 7, stored_items: 1, status: 'partial' } },
  });
  expect(saved.status !== 'failed' && saved.notice).toContain('6 media items missing');
});
