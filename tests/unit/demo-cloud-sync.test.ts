/**
 * Unit tests for demo cloud sync (TASK-004 follow-up).
 *
 * The bug this guards: a guidance `demo_ref` synced across machines while the
 * recorded demo itself stayed local-only, so a fresh machine LISTED a workflow
 * that `replay_demo` then failed to run. The fix is body sync through
 * `extend.wbx_demo`, and these tests pin its two halves —
 *
 *   1. mirror-on-save   — saveDemo() pushes the body to the cloud, and
 *                         saveDemo(..., {sync:false}) (the hydrate path) does NOT,
 *                         which is what stops a merge echoing back.
 *   2. hydrate-on-sign-in — a cloud demo lands in the local cache, a locally
 *                         newer copy wins, and a tombstone deletes locally.
 *
 * Plus the on-miss repair (`getDemoOrHydrate`) that keeps a ref honest when it
 * arrives before the hydrate has run, and the mapper's refusal to accept a
 * body-less row (which would overwrite a good local copy with a hollow one).
 */

import { demoToRowPayload, rowToDemo } from '@/lib/demos/cloud-sync';
import type { Demo } from '@/lib/demos/types';
import type { WbxDemoRow } from '@/lib/supabase/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── The cloud, in memory ────────────────────────────────────────────────────
const upsertDemoRow = vi.fn(async (_p: unknown) => true);
const deleteDemoRow = vi.fn(async (_id: string) => true);
let cloudRows: WbxDemoRow[] = [];

vi.mock('@/lib/supabase/queries', () => ({
  upsertDemoRow: (p: unknown) => upsertDemoRow(p),
  deleteDemoRow: (id: string) => deleteDemoRow(id),
  fetchAllDemoRows: async () => cloudRows,
  fetchDemoRow: async (id: string) => cloudRows.find((r) => r.id === id) ?? null,
}));

const CREATED = Date.parse('2026-08-09T10:00:00.000Z');
const UPDATED = Date.parse('2026-08-09T11:30:00.000Z');

function makeDemo(over: Partial<Demo> = {}): Demo {
  return {
    id: 'demo_login',
    name: 'Login flow',
    description: 'sign in and land on the dashboard',
    start_url: 'https://example.com/login',
    step_count: 2,
    parameter_names: ['username'],
    created_at: CREATED,
    updated_at: UPDATED,
    parameters: [{ name: 'username', description: 'the email', sensitive: false }],
    steps: [
      {
        id: 's1',
        index: 0,
        kind: 'navigate',
        url: 'https://example.com/login',
        source_tab_id: 7,
        ts_ms_offset: 0,
        selector_chain: [],
        navigation_url: 'https://example.com/login',
      },
      {
        id: 's2',
        index: 1,
        kind: 'click',
        url: 'https://example.com/login',
        source_tab_id: 7,
        ts_ms_offset: 900,
        selector_chain: [{ kind: 'id', selector: '#submit' }],
        element_snapshot: { tag: 'button', accessible_name: 'Sign in' },
      },
    ],
    ...over,
  };
}

/** Turn a save payload into the row shape PostgREST would hand back. */
function rowFor(demo: Demo, over: Partial<WbxDemoRow> = {}): WbxDemoRow {
  const p = demoToRowPayload(demo);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    start_url: p.start_url,
    step_count: p.step_count,
    parameter_names: p.parameter_names,
    body: p.body,
    // Server clock — deliberately unrelated to the client timestamps in `body`.
    created_at: '2026-08-09T10:00:02.000Z',
    updated_at: '2026-08-09T11:30:04.000Z',
    is_deleted: false,
    ...over,
  };
}

async function resetLocalDemos(): Promise<void> {
  const { listDemos, deleteDemo } = await import('@/lib/demos/storage');
  for (const d of await listDemos()) await deleteDemo(d.id, { sync: false });
}

beforeEach(async () => {
  upsertDemoRow.mockClear();
  deleteDemoRow.mockClear();
  cloudRows = [];
  await resetLocalDemos();
});

describe('demo cloud-sync mappers', () => {
  it('round-trips a demo through the row shape', () => {
    const demo = makeDemo();
    expect(rowToDemo(rowFor(demo))).toEqual(demo);
  });

  it('reads the client timestamps from the body, not the server columns', () => {
    // _100_touch_row overwrites the updated_at COLUMN with now() on every
    // write, so trusting it would make every cloud row look newer than a
    // locally-edited one and clobber real work.
    const back = rowToDemo(rowFor(makeDemo()));
    expect(back?.created_at).toBe(CREATED);
    expect(back?.updated_at).toBe(UPDATED);
  });

  it('rejects a row whose body is missing or step-less', () => {
    expect(rowToDemo(rowFor(makeDemo(), { body: null }))).toBeNull();
    expect(rowToDemo(rowFor(makeDemo(), { body: { name: 'x' } }))).toBeNull();
  });
});

describe('mirror-on-save', () => {
  it('pushes the full body to the cloud when a demo is saved', async () => {
    const { saveDemo } = await import('@/lib/demos/storage');
    const demo = makeDemo();
    await saveDemo(demo);

    await vi.waitFor(() => expect(upsertDemoRow).toHaveBeenCalledTimes(1));
    const payload = upsertDemoRow.mock.calls[0]?.[0] as ReturnType<typeof demoToRowPayload>;
    expect(payload.id).toBe('demo_login');
    expect(payload.step_count).toBe(2);
    expect(payload.parameter_names).toEqual(['username']);
    // The whole recorded step list travels — that is the entire point.
    expect((payload.body as Demo).steps).toHaveLength(2);
    // The pure local-to-row mapper owns neither actor nor request identity.
    // upsertDemoRow adds organization_id at the Supabase boundary; the actor
    // remains server-stamped.
    expect(payload).not.toHaveProperty('created_by');
    expect(payload).not.toHaveProperty('organization_id');
  });

  it('does not echo back to the cloud when the hydrate writes locally', async () => {
    const { saveDemo, getDemo } = await import('@/lib/demos/storage');
    await saveDemo(makeDemo(), { sync: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertDemoRow).not.toHaveBeenCalled();
    expect(await getDemo('demo_login')).not.toBeNull();
  });

  it('tombstones the cloud row on delete', async () => {
    const { saveDemo, deleteDemo } = await import('@/lib/demos/storage');
    await saveDemo(makeDemo(), { sync: false });
    await deleteDemo('demo_login');
    await vi.waitFor(() => expect(deleteDemoRow).toHaveBeenCalledWith('demo_login'));
  });
});

describe('hydrate-on-sign-in', () => {
  it('merges a demo recorded on another machine into the local cache', async () => {
    const remote = makeDemo();
    cloudRows = [rowFor(remote)];

    const { hydrateDemosFromCloud } = await import('@/lib/demos/cloud-sync');
    const { getDemo, listDemos } = await import('@/lib/demos/storage');

    expect(await getDemo('demo_login')).toBeNull(); // the pre-fix failure state
    const res = await hydrateDemosFromCloud();
    expect(res).toEqual({ merged: 1, ok: true });

    const local = await getDemo('demo_login');
    expect(local).toEqual(remote);
    // Replayable, not just listable — steps are what replay_demo needs.
    expect(local?.steps).toHaveLength(2);
    expect((await listDemos()).map((d) => d.id)).toContain('demo_login');

    // Hydration must not push what it just pulled.
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertDemoRow).not.toHaveBeenCalled();
  });

  it('keeps a locally newer copy (last-write-wins)', async () => {
    const { saveDemo, getDemo } = await import('@/lib/demos/storage');
    const { hydrateDemosFromCloud } = await import('@/lib/demos/cloud-sync');

    await saveDemo(makeDemo({ name: 'Newer local', updated_at: UPDATED + 60_000 }), {
      sync: false,
    });
    cloudRows = [rowFor(makeDemo({ name: 'Older cloud' }))];

    expect(await hydrateDemosFromCloud()).toEqual({ merged: 0, ok: true });
    expect((await getDemo('demo_login'))?.name).toBe('Newer local');
  });

  it('applies a cloud tombstone locally', async () => {
    const { saveDemo, getDemo } = await import('@/lib/demos/storage');
    const { hydrateDemosFromCloud } = await import('@/lib/demos/cloud-sync');

    await saveDemo(makeDemo(), { sync: false });
    cloudRows = [
      rowFor(makeDemo(), { is_deleted: true, updated_at: new Date(UPDATED + 5_000).toISOString() }),
    ];

    expect(await hydrateDemosFromCloud()).toEqual({ merged: 1, ok: true });
    expect(await getDemo('demo_login')).toBeNull();
  });
});

describe('on-miss repair', () => {
  it('pulls just the one demo a ref points at', async () => {
    cloudRows = [rowFor(makeDemo())];
    const { getDemoOrHydrate } = await import('@/lib/demos/cloud-sync');
    const { getDemo } = await import('@/lib/demos/storage');

    const demo = await getDemoOrHydrate('demo_login');
    expect(demo?.steps).toHaveLength(2);
    // Cached for next time, and still not echoed back.
    expect(await getDemo('demo_login')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertDemoRow).not.toHaveBeenCalled();
  });

  it('returns null for an unknown id and for a tombstoned one', async () => {
    const { getDemoOrHydrate } = await import('@/lib/demos/cloud-sync');
    expect(await getDemoOrHydrate('demo_nope')).toBeNull();
    cloudRows = [rowFor(makeDemo(), { is_deleted: true })];
    expect(await getDemoOrHydrate('demo_login')).toBeNull();
  });
});
