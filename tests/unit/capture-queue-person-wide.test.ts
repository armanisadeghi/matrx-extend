/**
 * THE TRAY FOLLOWS THE PERSON, NOT THE SELECTED ORGANIZATION.
 *
 * The live subscription is ONE person-wide channel with NO organization filter
 * (Realtime applies the person's own RLS), so pushes arrive for every organization
 * they belong to; switching the header's organization neither re-subscribes nor
 * changes what the tray shows. Each update carries organization names by id for the
 * per-item label.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/org/active-org', () => ({
  listMemberOrganizations: vi.fn(),
}));
const filters: string[] = [];
vi.mock('@/lib/supabase/schemas', () => ({
  mediaDb: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'is', 'neq']) chain[m] = () => chain;
      chain.eq = (col: string) => {
        filters.push(col);
        return chain;
      };
      chain.order = () => Promise.resolve({ data: [], error: null });
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/db-failure', () => ({ failDbCall: vi.fn() }));

interface Opened {
  topic: string;
  postgresChanges: { filter?: string }[];
}
const opened: Opened[] = [];
vi.mock('@ai-matrx/realtime', () => ({
  defineChannelNamespace: () => ({ topic: () => 'capture:person' }),
  onRealtimeManagerChange: (cb: (manager: unknown) => void) => {
    cb({
      open: (binding: Opened) => {
        opened.push(binding);
        return { close: () => {} };
      },
    });
    return () => {};
  },
}));

import { subscribeNeedsYou } from '@/lib/capture-ladder/queue';
import { listMemberOrganizations } from '@/lib/org/active-org';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe('the capture tray is person-wide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opened.length = 0;
    filters.length = 0;
    vi.mocked(listMemberOrganizations).mockResolvedValue([
      { id: 'org-a', name: "admin's Workspace" },
      { id: 'org-b', name: 'AI Matrx' },
    ]);
  });

  it('opens one channel with no organization filter, and reads with no organization filter', async () => {
    const updates: { organizationNames: Record<string, string> }[] = [];
    const stop = subscribeNeedsYou((u) => updates.push(u), { pollMs: 600_000 });
    await flush();
    expect(opened).toHaveLength(1);
    expect(opened[0]?.postgresChanges[0]?.filter).toBeUndefined();
    expect(filters).not.toContain('organization_id');
    expect(updates.at(-1)?.organizationNames).toEqual({
      'org-a': "admin's Workspace",
      'org-b': 'AI Matrx',
    });
    stop();
  });
});
