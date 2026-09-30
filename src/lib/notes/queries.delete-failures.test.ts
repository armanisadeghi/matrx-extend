import { softDeleteNote } from '@/lib/notes/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ workbenchDb: vi.fn() }));
vi.mock('@/lib/supabase/schemas', () => ({ workbenchDb: db.workbenchDb }));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: vi.fn() }));

const noteId = '11111111-1111-4111-8111-111111111111';

function deleteResult(result: { count: number | null; error: { message: string } | null }) {
  const eq = vi.fn(async () => result);
  const update = vi.fn(() => ({ eq }));
  db.workbenchDb.mockReturnValue({
    from: () => ({ update }),
  });
  return { update, eq };
}

beforeEach(() => vi.clearAllMocks());

describe('Notes delete confirmation boundary', () => {
  it('refuses success when UPDATE affected no visible note', async () => {
    const { update, eq } = deleteResult({ count: 0, error: null });
    await expect(softDeleteNote(noteId)).resolves.toBe(false);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }),
      { count: 'exact' },
    );
    expect(eq).toHaveBeenCalledWith('id', noteId);
  });

  it('confirms only one affected row', async () => {
    deleteResult({ count: 1, error: null });
    await expect(softDeleteNote(noteId)).resolves.toBe(true);
    deleteResult({ count: null, error: null });
    await expect(softDeleteNote(noteId)).resolves.toBe(false);
  });

  it('refuses success on a database error', async () => {
    deleteResult({ count: null, error: { message: 'Update denied' } });
    await expect(softDeleteNote(noteId)).resolves.toBe(false);
  });
});
