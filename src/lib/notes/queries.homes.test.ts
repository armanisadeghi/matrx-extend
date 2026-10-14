import { createNote, listMyHomes, moveNoteHome } from '@/lib/notes/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  workbenchDb: vi.fn(),
  platformDb: vi.fn(),
}));
vi.mock('@/lib/supabase/schemas', () => db);
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({ schema: () => db.platformDb() }),
}));
vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: async () => '33333333-3333-4333-8333-333333333333',
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ORG_A = '44444444-4444-4444-8444-444444444444';
const ORG_B = '55555555-5555-4555-8555-555555555555';

beforeEach(() => vi.clearAllMocks());

describe('Notes homes boundary', () => {
  it('preserves a refused homes read as an error, not an empty home picker', async () => {
    db.platformDb.mockReturnValue({
      rpc: async () => ({ data: null, error: { message: 'Scope access refused' } }),
    });
    await expect(listMyHomes()).rejects.toThrow('Could not load homes: Scope access refused');
  });

  it('moves a note with the set_home RPC, never a direct column write', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    db.platformDb.mockReturnValue({ rpc });
    await expect(moveNoteHome('note-1', A)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('set_home', {
      p_entity_type: 'note',
      p_entity_id: 'note-1',
      p_scope_id: A,
    });
    db.platformDb.mockReturnValue({ rpc: async () => ({ error: { message: 'refused' } }) });
    await expect(moveNoteHome('note-1', A)).resolves.toBe(false);
  });

  it('creates a note with the organization and NO home (the database files it in General)', async () => {
    const insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: null, error: { message: 'x' } }) }),
    }));
    db.workbenchDb.mockReturnValue({ from: () => ({ insert }) });
    await createNote({ label: 'Plan' });
    const payload = (insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload.organization_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(Object.keys(payload)).not.toContain('home_scope_id');
    expect(Object.keys(payload).some((k) => k.startsWith('folder'))).toBe(false);
  });

  it('disambiguates ordinary homes across organizations using names returned by the platform', async () => {
    db.platformDb.mockReturnValue({
      rpc: async () => ({
        data: [
          {
            scope_id: A,
            organization_id: ORG_A,
            organization_name: 'AI Matrx',
            name: 'Intake',
            is_general: false,
          },
          {
            scope_id: B,
            organization_id: ORG_B,
            organization_name: 'Law Firm',
            name: 'Intake',
            is_general: false,
          },
          {
            scope_id: '66666666-6666-4666-8666-666666666666',
            organization_id: ORG_A,
            organization_name: 'AI Matrx',
            name: 'ABC Legal',
            is_general: false,
          },
        ],
        error: null,
      }),
    });
    expect((await listMyHomes()).map((h) => h.label)).toEqual([
      'ABC Legal',
      'Intake · AI Matrx',
      'Intake · Law Firm',
    ]);
  });
});
