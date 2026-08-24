import { addTasks } from '@/lib/lists/storage';
import { createNote } from '@/lib/notes/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRequestOrganizationId: vi.fn(),
  workbenchDb: vi.fn(),
  chatDb: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: mocks.requireRequestOrganizationId,
}));

vi.mock('@/lib/supabase/schemas', () => ({
  workbenchDb: mocks.workbenchDb,
  chatDb: mocks.chatDb,
}));

vi.mock('@/lib/messaging/native', () => ({ broadcast: mocks.broadcast }));

const ORG_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';

describe('explicit organization writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses note creation before Supabase when request organization is missing', async () => {
    mocks.requireRequestOrganizationId.mockRejectedValue(
      new Error('Workspace initialization failed: the request carried no organization.'),
    );

    await expect(createNote({ label: 'Blocked' })).rejects.toThrow(
      'the request carried no organization',
    );
    expect(mocks.workbenchDb).not.toHaveBeenCalled();
  });

  it('stamps the exact request organization on a note insert', async () => {
    mocks.requireRequestOrganizationId.mockResolvedValue(ORG_ID);
    const inserted: unknown[] = [];
    const note = {
      id: '44444444-4444-4444-8444-444444444444',
      created_by: '55555555-5555-4555-8555-555555555555',
      label: 'Explicit',
      folder_name: null,
      folder_id: null,
      tags: null,
      updated_at: '2026-08-23T00:00:00Z',
      position: null,
      visibility: 'private',
      content: '',
      metadata: null,
      deleted_at: null,
      version: 1,
      created_at: '2026-08-23T00:00:00Z',
    };
    mocks.workbenchDb.mockReturnValue({
      from: () => ({
        insert: (payload: unknown) => {
          inserted.push(payload);
          return { select: () => ({ single: async () => ({ data: note, error: null }) }) };
        },
      }),
    });

    await expect(createNote({ label: 'Explicit' })).resolves.toMatchObject({ label: 'Explicit' });
    expect(inserted).toEqual([
      {
        organization_id: ORG_ID,
        label: 'Explicit',
        content: '',
        folder_name: null,
        folder_id: null,
      },
    ]);
  });

  it('refuses task creation before insert when the parent has no organization', async () => {
    const insert = vi.fn();
    mocks.chatDb.mockReturnValue({
      from: (table: string) => {
        if (table === 'conversation') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          };
        }
        return { insert };
      },
    });

    await expect(addTasks(CONVERSATION_ID, [{ title: 'Blocked' }])).rejects.toThrow(
      'has no valid organization_id',
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('copies the authoritative parent organization into every task insert', async () => {
    const inserted: unknown[] = [];
    mocks.chatDb.mockReturnValue({
      from: (table: string) => {
        if (table === 'conversation') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { organization_id: ORG_ID },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({ order: async () => ({ data: [], error: null }) }),
          }),
          insert: (rows: unknown[]) => {
            inserted.push(...rows);
            return {
              select: async () => ({
                data: [
                  {
                    id: '66666666-6666-4666-8666-666666666666',
                    ...(rows[0] as Record<string, unknown>),
                    created_at: '2026-08-23T00:00:00Z',
                    updated_at: '2026-08-23T00:00:00Z',
                  },
                ],
                error: null,
              }),
            };
          },
        };
      },
    });

    await expect(
      addTasks(CONVERSATION_ID, [{ title: 'One' }, { title: 'Two' }]),
    ).resolves.toHaveLength(1);
    expect(inserted).toEqual([
      expect.objectContaining({
        organization_id: ORG_ID,
        conversation_id: CONVERSATION_ID,
        title: 'One',
      }),
      expect.objectContaining({
        organization_id: ORG_ID,
        conversation_id: CONVERSATION_ID,
        title: 'Two',
      }),
    ]);
  });
});
