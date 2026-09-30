import { listMyNotes } from '@/lib/notes/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ workbenchDb: vi.fn() }));
vi.mock('@/lib/supabase/schemas', () => ({ workbenchDb: db.workbenchDb }));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('Notes read boundary', () => {
  it('rejects a failed SELECT instead of claiming the collection is empty', async () => {
    db.workbenchDb.mockReturnValue({
      from: () => ({
        select: () => ({
          is: () => ({ order: async () => ({ data: null, error: { message: 'Network unavailable' } }) }),
        }),
      }),
    });
    await expect(listMyNotes()).rejects.toThrow('Network unavailable');
  });

  it('returns an empty collection for a successful empty SELECT', async () => {
    db.workbenchDb.mockReturnValue({
      from: () => ({
        select: () => ({ is: () => ({ order: async () => ({ data: [], error: null }) }) }),
      }),
    });
    await expect(listMyNotes()).resolves.toEqual([]);
  });
});
