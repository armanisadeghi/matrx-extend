import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ fetch: vi.fn(), put: vi.fn(), remove: vi.fn() }));
const client = createClient('https://library.aimatrx.com', 'public-library-key', {
  global: { fetch: harness.fetch },
  auth: { persistSession: false, autoRefreshToken: false },
});
vi.mock('@/lib/supabase/schemas', () => ({
  socialDb: () => client.schema('social'),
  platformDb: () => client.schema('platform'),
}));
vi.mock('@/lib/api/client', () => ({ apiPut: harness.put, apiDelete: harness.remove }));
import {
  readSwipeCollections,
  readSwipeMemberships,
  removeSwipeMembership,
  updateSwipeCollection,
  updateSwipeNotes,
} from '@/lib/swipe-file/library';

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
    const rows = [
      collection('launch', 'studio-west'),
      collection('reels', 'studio-east'),
      collection('hooks', 'studio-north'),
    ];
    harness.fetch.mockImplementation(async (url: string) => {
      const u = new URL(url);
      expect(u.searchParams.has('organization_id')).toBe(false);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      return json(rows.slice(offset, offset + 2), {
        'content-range': `${offset}-${Math.min(offset + 1, 2)}/3`,
      });
    });
    expect((await readSwipeCollections()).map((c) => c.organization_id)).toEqual([
      'studio-west',
      'studio-east',
      'studio-north',
    ]);
    expect(harness.fetch).toHaveBeenCalledTimes(2);
    const second = new URL(String(harness.fetch.mock.calls[1]?.[0]));
    expect(second.searchParams.get('offset')).toBe('2');
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
      expect(u.searchParams.get('organization_id')).toBe('eq.studio-west');
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(String(options.body))).toEqual({ name: 'Spring campaign' });
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
