import { createScriptDb } from '@ai-matrx/data/script';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ fetch: vi.fn(), put: vi.fn(), remove: vi.fn() }));
vi.stubGlobal('fetch', harness.fetch);
const db = createScriptDb({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://library.aimatrx.com',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-library-key',
  },
});
if (!db) throw new Error('Test database transport unavailable.');
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => db.client }));
vi.mock('@/lib/api/client', () => ({ apiPut: harness.put, apiDelete: harness.remove }));
import {
  readSwipeCollections,
  readSwipeMemberships,
  readSwipePost,
  removeSwipeMembership,
  updateSwipeCollection,
  updateSwipeNotes,
} from '@/lib/swipe-file/library';
import { listCollections } from '@/lib/swipe-file/store';

const collection = (id: string, org: string) => ({
  id,
  name: `Campaign ${id}`,
  organization_id: org,
  deleted_at: null,
});
const membership = {
  id: 'edge-pinterest',
  source_id: 'ideas',
  target_id: 'post-landscape',
  target_type: 'social_post',
  organization_id: 'studio-west',
  metadata: { note: 'Opening shot', tags: ['landscape'] },
  created_at: '2026-10-10T15:00:00Z',
};
const json = (data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
beforeEach(() => {
  vi.clearAllMocks();
  harness.put.mockResolvedValue({ ok: true, data: { saved: true } });
  harness.remove.mockResolvedValue({ ok: true, data: { removed: 1 } });
});
describe('canonical swipe library', () => {
  it('keeps every visible organization and follows server pagination instead of silently losing later collections', async () => {
    const rows = Array.from({ length: 1003 }, (_, index) =>
      collection(`campaign-${index}`, index % 2 ? 'studio-west' : 'studio-east'),
    );
    harness.fetch.mockImplementation(async (url: string) => {
      const u = new URL(url);
      expect(u.searchParams.has('organization_id')).toBe(false);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const limit = Math.min(Number(u.searchParams.get('limit') ?? 1000), 1000);
      return json(rows.slice(offset, offset + limit), {
        'content-range': `${offset}-${Math.min(offset + limit - 1, 1002)}/1003`,
      });
    });
    const loaded = await readSwipeCollections();
    expect(loaded).toHaveLength(1003);
    expect(loaded.some((row) => row.id === 'campaign-1002')).toBe(true);
    expect(new Set(loaded.map((c) => c.organization_id))).toEqual(
      new Set(['studio-east', 'studio-west']),
    );
    expect(harness.fetch).toHaveBeenCalledTimes(2);
    const second = new URL(String(harness.fetch.mock.calls[1]?.[0]));
    expect(second.searchParams.get('offset')).toBe('1000');
  });
  it('the floating picker uses the same uncapped all-organization collection reader as the manager', async () => {
    const rows = Array.from({ length: 203 }, (_, index) =>
      collection(`campaign-${index}`, index % 2 ? 'studio-west' : 'studio-east'),
    );
    harness.fetch.mockImplementation(async (url: string) => {
      const u = new URL(url);
      expect(u.searchParams.has('organization_id')).toBe(false);
      expect(u.searchParams.get('deleted_at')).toBe('is.null');
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const limit = Number(u.searchParams.get('limit') ?? 200);
      return json(rows.slice(offset, offset + limit), {
        'content-range': `${offset}-${Math.min(offset + limit - 1, 202)}/203`,
      });
    });
    const loaded = await listCollections();
    expect(loaded).toHaveLength(203);
    expect(loaded.some((row) => row.id === 'campaign-202')).toBe(true);
  });
  it('shows archived collections only when the visible control asks for them', async () => {
    harness.fetch.mockImplementation(async (url: string) => {
      const u = new URL(url);
      return json(
        u.searchParams.has('deleted_at')
          ? [collection('launch', 'studio-west')]
          : [
              collection('launch', 'studio-west'),
              { ...collection('archive', 'studio-east'), deleted_at: '2026-10-01T00:00:00Z' },
            ],
      );
    });
    expect(await readSwipeCollections()).toHaveLength(1);
    expect(await readSwipeCollections(true)).toHaveLength(2);
  });
  it('keeps non-post membership visible and refuses malformed canonical rows', async () => {
    harness.fetch.mockResolvedValueOnce(json([{ ...membership, target_type: 'social_ad' }]));
    expect((await readSwipeMemberships())[0]?.target_type).toBe('social_ad');
    harness.fetch.mockResolvedValueOnce(json([{ id: 'broken' }]));
    await expect(readSwipeMemberships()).rejects.toThrow();
  });
  it('details choose the latest observed metrics and newest transcript instead of UUID order or null observations', async () => {
    harness.fetch.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/post'))
        return json({
          id: 'sunrise',
          organization_id: 'shared-library',
          platform: 'instagram',
          url: 'https://instagram.com/p/sunrise',
          title: 'Sunrise',
          caption: 'Morning over the ridge',
          format: 'video',
          posted_at: null,
          hashtags: [],
          mentions: [],
          profile_id: null,
        });
      if (u.pathname.endsWith('/post_transcript')) {
        expect(u.searchParams.get('order')).toBe('created_at.asc,id.asc');
        return json([
          { id: 'old-voice', text: 'Earlier wording', language: 'en', source: 'provider' },
          { id: 'latest-voice', text: 'A new day', language: 'en', source: 'provider' },
        ]);
      }
      expect(u.searchParams.get('order')).toBe('metrics_observed_at.asc,id.asc');
      return json([
        {
          views: 100,
          likes: 10,
          comments: 2,
          shares: 1,
          saves: 3,
          metrics_observed_at: '2026-10-09T15:00:00Z',
        },
        {
          views: 240,
          likes: 18,
          comments: 4,
          shares: 3,
          saves: 5,
          metrics_observed_at: '2026-10-10T15:00:00Z',
        },
        {
          views: 999,
          likes: null,
          comments: null,
          shares: null,
          saves: null,
          metrics_observed_at: null,
        },
      ]);
    });
    const detail = await readSwipePost('sunrise');
    expect(detail.stats?.views).toBe(240);
    expect(detail.transcripts[0]?.text).toBe('A new day');
  });
  it('edits and removes in the destination organization even after the active organization changes', async () => {
    await updateSwipeNotes(membership, 'Sequence idea', ['opening']);
    expect(harness.put).toHaveBeenCalledWith(
      '/social/collections/ideas/items/social_post/post-landscape',
      { note: 'Sequence idea', tags: ['opening'] },
      undefined,
      { organizationId: 'studio-west' },
    );
    await removeSwipeMembership({
      ...membership,
      organization_id: 'studio-east',
      source_id: 'reels',
    });
    expect(harness.remove).toHaveBeenCalledWith(
      '/social/collections/reels/items/social_post/post-landscape',
      undefined,
      { organizationId: 'studio-east' },
    );
    harness.put.mockResolvedValue({ ok: false, error: 'Not permitted' });
    await expect(updateSwipeNotes(membership, 'Changed', [])).rejects.toThrow('Not permitted');
  });
  it('collection updates carry the authoritative parent organization and expose a denied write', async () => {
    harness.fetch.mockImplementation(async (url: string, options: RequestInit) => {
      const u = new URL(url);
      expect(u.searchParams.get('id')).toBe('eq.launch');
      expect(u.searchParams.has('organization_id')).toBe(false);
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(String(options.body))).toEqual({
        name: 'Spring campaign',
        organization_id: 'studio-west',
      });
      return json({ id: 'launch' });
    });
    await updateSwipeCollection(collection('launch', 'studio-west'), { name: 'Spring campaign' });
    harness.fetch.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Permission denied' }), { status: 403 }),
    );
    await expect(
      updateSwipeCollection(collection('launch', 'studio-west'), {
        deleted_at: '2026-10-10T12:00:00Z',
      }),
    ).rejects.toThrow('Permission denied');
  });
});
