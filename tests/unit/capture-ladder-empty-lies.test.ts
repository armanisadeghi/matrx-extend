/**
 * THE LYING ZERO, AS A GUARD.
 *
 * The class of defect: **a queue read that returns zero rows for the active
 * organization, while the person has rows in another of their own
 * organizations, must not produce an "empty" UI state that omits the elsewhere
 * count.** That is what actually happened — the web app's tray said "2 pages
 * are waiting for your browser", the extension showed a calm "Nothing needs
 * your browser", and the rows were sitting in two other organizations the same
 * person is a member of.
 *
 * These tests bite on three seams, so deleting any half of the fix turns them
 * red:
 *   1. `countNeedsYouElsewhere()` — that the read exists, uses the person's
 *      OWN memberships, and EXCLUDES the active organization.
 *   2. `queueSentences()` — that an empty active queue with work elsewhere can
 *      never render as a bare nothing, and always names where it looked.
 *   3. `captureTabLabel()` — that the tab's accessible name says it too, and
 *      that the badge number is never inflated by other workspaces' rows.
 *
 * Plus the pointer rules (`orderForPickup`, expiry), because a pointer that
 * silently misses is the same class of lie in a smaller place.
 *
 * PROVEN FAILING-THEN-PASSING — the exact numbers are in this lane's report.
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

import {
  captureTabLabel,
  captureTabShortLabel,
  queueSentences,
} from '@/features/capture-ladder/queue-sentences';
import {
  CAPTURE_PICKUP_MAX_AGE_MS,
  isPickupFresh,
  orderForPickup,
  pickupMissWhy,
} from '@/lib/capture-ladder/pickup';
import { countNeedsYouElsewhere } from '@/lib/capture-ladder/queue';
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

describe('countNeedsYouElsewhere — the read that can answer "and where else?"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listMemberOrganizations).mockResolvedValue(MEMBERSHIPS);
  });

  it('counts waiting rows per organization and EXCLUDES the active one', async () => {
    vi.mocked(getActiveOrganizationId).mockResolvedValue(WORKSPACE);
    const calls = stubMediaDb([
      { organization_id: AI_MATRX },
      { organization_id: PROBE },
      { organization_id: PROBE },
      // A row for the ACTIVE organization must never be counted as "elsewhere"
      // even if the database hands one back.
      { organization_id: WORKSPACE },
    ]);

    const report = await countNeedsYouElsewhere();

    expect(report.activeOrganizationId).toBe(WORKSPACE);
    expect(report.activeOrganizationName).toBe("admin's Workspace");
    expect(report.elsewhere.map((e) => [e.organizationName, e.count])).toEqual([
      ['ZZZ G2 Activation Probe', 2],
      ['AI Matrx', 1],
    ]);
    expect(report.total).toBe(3);
    // Every organization asked about came from the person's OWN memberships —
    // this is not cross-organization reach.
    expect(calls['in:organization_id']).toEqual([AI_MATRX, PROBE]);
  });

  it('asks about nothing when the person has exactly one membership', async () => {
    vi.mocked(getActiveOrganizationId).mockResolvedValue(AI_MATRX);
    vi.mocked(listMemberOrganizations).mockResolvedValue([MEMBERSHIPS[0] as never]);
    stubMediaDb([]);
    const report = await countNeedsYouElsewhere();
    expect(report.elsewhere).toEqual([]);
    expect(report.total).toBe(0);
    expect(report.activeOrganizationName).toBe('AI Matrx');
  });

  it('never turns a database refusal into "there is nowhere else"', async () => {
    vi.mocked(getActiveOrganizationId).mockResolvedValue(WORKSPACE);
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      in: () => builder,
      is: () => builder,
      // biome-ignore lint/suspicious/noThenProperty: a PostgrestFilterBuilder IS a thenable — a stand-in for one has to be too.
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: { code: '42501', message: 'permission denied' } }),
    });
    vi.mocked(mediaDb).mockReturnValue({ from: () => builder } as never);
    await expect(countNeedsYouElsewhere()).rejects.toThrow(/db refused/);
  });
});

describe('THE GUARD — an empty queue with work elsewhere is never a bare "nothing"', () => {
  it('names the workspace it looked in AND the one that holds the pages', () => {
    const s = queueSentences({
      itemCount: 0,
      organizationName: "admin's Workspace",
      elsewhere: [{ organizationId: AI_MATRX, organizationName: 'AI Matrx', count: 4 }],
    });

    // The exact failure: an empty state that says only "Nothing needs your
    // browser" and stops.
    expect(s.headline).toContain("admin's Workspace");
    expect(s.emptyLine).toContain("admin's Workspace");
    expect(s.elsewhereLine).not.toBeNull();
    expect(s.elsewhereLine).toContain('4 pages');
    expect(s.elsewhereLine).toContain('AI Matrx');
    // …and a real control, not just prose.
    expect(s.switchTo?.organizationId).toBe(AI_MATRX);
    expect(s.switchLabel).toBe('Switch to AI Matrx');
  });

  it('offers the workspace with the most waiting pages when several hold some', () => {
    const s = queueSentences({
      itemCount: 0,
      organizationName: 'AI Matrx',
      elsewhere: [
        { organizationId: WORKSPACE, organizationName: "admin's Workspace", count: 4 },
        { organizationId: PROBE, organizationName: 'ZZZ G2 Activation Probe', count: 2 },
      ],
    });
    expect(s.elsewhereLine).toBe('6 pages are waiting in 2 of your other workspaces.');
    expect(s.switchTo?.organizationId).toBe(WORKSPACE);
  });

  it('keeps the explanation to ONE line — no paragraphs, no second sentence about elsewhere', () => {
    const s = queueSentences({
      itemCount: 0,
      organizationName: 'AI Matrx',
      elsewhere: [{ organizationId: PROBE, organizationName: 'ZZZ G2 Activation Probe', count: 1 }],
    });
    expect(s.elsewhereLine).toBe('1 page is waiting in ZZZ G2 Activation Probe.');
    expect((s.elsewhereLine ?? '').split('. ').length).toBe(1);
  });

  it('still says WHERE it looked when there is genuinely nothing anywhere', () => {
    const s = queueSentences({ itemCount: 0, organizationName: 'AI Matrx', elsewhere: [] });
    expect(s.headline).toBe('Nothing needs your browser in AI Matrx');
    expect(s.elsewhereLine).toBeNull();
    expect(s.switchTo).toBeNull();
  });

  it('never leaves the workspace blank when none is resolved yet', () => {
    const s = queueSentences({ itemCount: 0, organizationName: null, elsewhere: [] });
    expect(s.headline).not.toBe('Nothing needs your browser in ');
    expect(s.headline).toMatch(/signed in to/);
  });

  it('says it could not check the other workspaces rather than implying there are none', () => {
    const s = queueSentences({
      itemCount: 0,
      organizationName: 'AI Matrx',
      elsewhere: [],
      elsewhereError: 'permission denied',
    });
    expect(s.elsewhereProblem).toContain('could not check your other workspaces');
    expect(s.elsewhereProblem).toContain('permission denied');
  });
});

describe('THE GUARD — the tab badge does not read a silent zero', () => {
  it('says "waiting in another workspace" when the active count is zero', () => {
    expect(captureTabLabel(0, 4)).toBe(
      'Nothing needs your browser here — 4 waiting in another workspace',
    );
    expect(captureTabShortLabel(0, 4)).not.toBe('');
  });

  it('never adds other workspaces into the actionable number', () => {
    const label = captureTabLabel(2, 4);
    expect(label).toContain('2 pages need your browser');
    expect(label).toContain('4 more waiting in another workspace');
    expect(label).not.toContain('6');
  });

  it('collapses to the plain name — and no label — when there is nothing anywhere', () => {
    expect(captureTabLabel(0, 0)).toBe('Pages that need your browser');
    expect(captureTabShortLabel(0, 0)).toBe('');
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
    const why = pickupMissWhy(pickup, 'AI Matrx');
    expect(why).toContain('https://example.com/gone');
    expect(why).toContain('AI Matrx');
  });

  it('expires a pointer so a stale one never pins the wrong row forever', () => {
    const now = Date.now();
    expect(isPickupFresh({ at: now - 1_000 }, now)).toBe(true);
    expect(isPickupFresh({ at: now - CAPTURE_PICKUP_MAX_AGE_MS + 1 }, now)).toBe(true);
    expect(isPickupFresh({ at: now - CAPTURE_PICKUP_MAX_AGE_MS - 1 }, now)).toBe(false);
  });
});
