/**
 * The capture tray reads by access, not by the selected organization.
 *
 * Guards: (1) `listNeedsYou()` sends NO organization filter and needs no selection;
 * (2) the tray's sentences never hedge about "another workspace" because the list
 * already spans every organization; (3) the pointer rules (`orderForPickup`, expiry) —
 * a pointer that silently misses is the same class of lie in a smaller place.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: vi.fn(),
  listMemberOrganizations: vi.fn(),
}));
vi.mock('@/lib/supabase/schemas', () => ({ mediaDb: vi.fn() }));
vi.mock('@/lib/supabase/db-failure', () => ({
  failDbCall: vi.fn((_site: unknown, error: unknown) => {
    throw new Error(`db refused: ${(error as { message?: string })?.message ?? 'unknown'}`);
  }),
}));
vi.mock('@ai-matrx/realtime', () => ({
  defineChannelNamespace: () => ({ topic: () => 'topic' }),
  onRealtimeManagerChange: () => () => undefined,
}));

import { captureTabLabel, queueSentences } from '@/features/capture-ladder/queue-sentences';
import {
  CAPTURE_PICKUP_MAX_AGE_MS,
  isPickupFresh,
  orderForPickup,
  pickupMissWhy,
} from '@/lib/capture-ladder/pickup';
import { listNeedsYou } from '@/lib/capture-ladder/queue';
import { getActiveOrganizationId, listMemberOrganizations } from '@/lib/org/active-org';
import { mediaDb } from '@/lib/supabase/schemas';

// The three organizations one real person's waiting rows were actually spread
// across (admin@admin.com, 2026-09-18).
const AI_MATRX = '5dc930e9-bd65-44a1-8369-af773f6e1a5b';
const WORKSPACE = '884d1ce8-7b49-4fba-a2f3-0f7dd7c83d4f';
const PROBE = '304cd2ed-a65e-4c52-8375-324e605d16bd';

const MEMBERSHIPS = [
  { id: AI_MATRX, name: 'AI Matrx' },
  { id: WORKSPACE, name: "admin's Workspace" },
  { id: PROBE, name: 'ZZZ G2 Activation Probe' },
];

/** A `mediaDb()` stand-in that records the filters and answers with rows. */
function stubMediaDb(rows: { organization_id: string }[]) {
  const calls: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  const chain = (key: string) => (a: unknown, b: unknown) => {
    calls[`${key}:${String(a)}`] = b;
    return builder;
  };
  Object.assign(builder, {
    select: () => builder,
    in: chain('in'),
    eq: chain('eq'),
    is: chain('is'),
    order: () => builder,
    // biome-ignore lint/suspicious/noThenProperty: a PostgrestFilterBuilder IS a thenable — a stand-in for one has to be too.
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  });
  vi.mocked(mediaDb).mockReturnValue({ from: () => builder } as never);
  return calls;
}

describe('the needs-you list is decided by access, never by the selected organization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberOrganizations).mockResolvedValue(MEMBERSHIPS);
  });

  it('reads every organization the person can access — no organization filter, no selection needed', async () => {
    vi.mocked(getActiveOrganizationId).mockResolvedValue(null);
    const calls = stubMediaDb([]);
    await listNeedsYou();
    expect(Object.keys(calls).some((k) => k.startsWith('eq:organization_id'))).toBe(false);
    expect(Object.keys(calls).some((k) => k.startsWith('in:organization_id'))).toBe(false);
  });
});

describe('the tray sentences never hedge about another workspace', () => {
  it('an empty list says plainly that nothing needs the browser', () => {
    const s = queueSentences(0);
    expect(s.headline).toBe('Nothing needs your browser');
    expect(s.emptyLine).toContain('Nothing needs your browser');
  });

  it('counts pages in the headline and the tab name', () => {
    expect(queueSentences(1).headline).toBe('1 page need your browser');
    expect(queueSentences(3).emptyLine).toBeNull();
    expect(captureTabLabel(2)).toBe('2 pages need your browser');
    expect(captureTabLabel(0)).toBe('Pages that need your browser');
  });
});

describe('the pointed-at page goes first, and a miss is said out loud', () => {
  const rows = [
    { id: 'a', url: 'https://instagram.com/nike' },
    { id: 'b', url: 'https://www.facebook.com/nasa' },
    { id: 'c', url: 'https://nytimes.com' },
  ];

  it('puts the pointed-at handoff first and leaves the rest in order', () => {
    const out = orderForPickup(rows, { handoffId: 'c', at: Date.now() });
    expect(out.items.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(out.pickedId).toBe('c');
    expect(out.matched).toBe(true);
  });

  it('falls back to the url when only a url was sent', () => {
    const out = orderForPickup(rows, { url: 'https://www.facebook.com/nasa', at: Date.now() });
    expect(out.items.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('reports a miss instead of silently reordering nothing', () => {
    const pickup = { handoffId: 'zzz', url: 'https://example.com/gone', at: Date.now() };
    const out = orderForPickup(rows, pickup);
    expect(out.matched).toBe(false);
    expect(out.pickedId).toBeNull();
    expect(out.items.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    const why = pickupMissWhy(pickup);
    expect(why).toContain('https://example.com/gone');
  });

  it('expires a pointer so a stale one never pins the wrong row forever', () => {
    const now = Date.now();
    expect(isPickupFresh({ at: now - 1_000 }, now)).toBe(true);
    expect(isPickupFresh({ at: now - CAPTURE_PICKUP_MAX_AGE_MS + 1 }, now)).toBe(true);
    expect(isPickupFresh({ at: now - CAPTURE_PICKUP_MAX_AGE_MS - 1 }, now)).toBe(false);
  });
});
