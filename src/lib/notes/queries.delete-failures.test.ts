import { softDeleteNote } from '@/lib/notes/queries';
import { useNoticeStore } from '@/state/notices';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ workbenchDb: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/debug/log', () => ({ log: { error: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ rpc: db.rpc }) }));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId: async () => 'member-org' }));
vi.mock('@/lib/telemetry/external-reporting', () => ({
  mayReportExternalTelemetry: async () => true,
}));
vi.mock('@/lib/supabase/schemas', () => ({ workbenchDb: db.workbenchDb }));
vi.mock('@/lib/api/routes/auth', () => ({ requireRequestOrganizationId: vi.fn() }));

const noteId = '11111111-1111-4111-8111-111111111111';

function deleteResult(result: {
  count: number | null;
  error: { message: string; code?: string } | null;
}) {
  const eq = vi.fn(async () => result);
  const update = vi.fn(() => ({ eq }));
  db.workbenchDb.mockReturnValue({
    from: () => ({ update }),
  });
  return { update, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.rpc.mockResolvedValue({ data: 'recorded-failure', error: null });
  useNoticeStore.getState().clear();
});

// A Harbor Dental member deleting an intake note must receive a failure notice
// and a durable diagnostic when the database cannot confirm the deletion.
describe('Notes delete confirmation boundary', () => {
  it.each([
    { count: 0, error: null, kind: 'refused', remedy: 'workspace admin' },
    { count: null, error: null, kind: 'refused', remedy: 'workspace admin' },
    { count: 2, error: null, kind: 'failed', remedy: 'contact support' },
    {
      count: null,
      error: { code: '42501', message: 'Update denied' },
      kind: 'refused',
      remedy: 'workspace admin',
    },
    {
      count: null,
      error: { message: 'Failed to fetch' },
      kind: 'unreachable',
      remedy: 'internet connection',
    },
  ])(
    'announces and records an unconfirmed deletion: $kind, count $count',
    async ({ count, error, kind, remedy }) => {
      const { update, eq } = deleteResult({ count, error });
      await expect(softDeleteNote(noteId)).rejects.toMatchObject({
        name: 'DbFailureError',
        kind,
        site: { table: 'workbench.notes', operation: 'update' },
      });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ deleted_at: expect.any(String) }),
        { count: 'exact' },
      );
      expect(eq).toHaveBeenCalledWith('id', noteId);
      expect(useNoticeStore.getState().notices).toEqual([
        expect.objectContaining({
          title: 'Note not deleted',
          message: expect.stringContaining(remedy),
        }),
      ]);
      await vi.waitFor(() =>
        expect(db.rpc).toHaveBeenCalledWith(
          'log_client_error',
          expect.objectContaining({
            p_source_app: 'matrx-extend',
            p_route: 'workbench.notes',
            p_context: expect.objectContaining({
              kind,
              operation: 'update',
              what: 'delete this note',
            }),
          }),
        ),
      );
    },
  );

  it('confirms exactly one affected row without reporting a failure', async () => {
    deleteResult({ count: 1, error: null });
    await expect(softDeleteNote(noteId)).resolves.toBe(true);
    expect(useNoticeStore.getState().notices).toEqual([]);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
