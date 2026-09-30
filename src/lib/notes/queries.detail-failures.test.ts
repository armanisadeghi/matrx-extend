import { getNote } from '@/lib/notes/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ workbenchDb: vi.fn() }));
vi.mock('@/lib/supabase/schemas', () => ({ workbenchDb: db.workbenchDb }));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: vi.fn() }));

function detailResult(result: { data: unknown; error: { message: string } | null }) {
  db.workbenchDb.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => result }) }),
    }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('Notes detail read boundary', () => {
  it('rejects a failed SELECT instead of pretending the note is missing', async () => {
    detailResult({ data: null, error: { message: 'Network unavailable' } });
    await expect(getNote('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      'Network unavailable',
    );
  });

  it('returns null for a successful SELECT with no matching note', async () => {
    detailResult({ data: null, error: null });
    await expect(getNote('11111111-1111-4111-8111-111111111111')).resolves.toBeNull();
  });

  it('rejects malformed returned data instead of calling the note missing', async () => {
    detailResult({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null });
    await expect(getNote('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      'unexpected shape',
    );
  });
});
