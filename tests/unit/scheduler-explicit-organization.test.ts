import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimRun } from '@/lib/agenda/queries';
import { claimTask } from '@/lib/scheduler-client/claim';
import { schedulerDb } from '@/lib/supabase/schemas';

vi.mock('@/lib/supabase/schemas', () => ({
  schedulerDb: vi.fn(),
}));

const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '11111111-1111-4111-8111-111111111111';

function testClient(insert: ReturnType<typeof vi.fn>): SupabaseClient {
  const single = vi.fn().mockResolvedValue({
    data: { id: '44444444-4444-4444-8444-444444444444' },
    error: null,
  });
  const select = vi.fn().mockReturnValue({ single });
  insert.mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  const schema = vi.fn().mockReturnValue({ from });
  return { schema } as unknown as SupabaseClient;
}

describe('scheduler run organization provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses an invalid task organization before constructing a database query', async () => {
    const schema = vi.fn();
    const client = { schema } as unknown as SupabaseClient;

    await expect(
      claimTask(client, {
        task: {
          id: TASK_ID,
          user_id: USER_ID,
          organization_id: '',
          next_due_at: null,
        },
        surface: 'chrome-extension-chat',
        instanceId: 'instance-1',
      }),
    ).rejects.toThrow('task has no valid organization_id');
    expect(schema).not.toHaveBeenCalled();
  });

  it('copies the persisted task organization into the run insert', async () => {
    const insert = vi.fn();
    const client = testClient(insert);

    await claimTask(client, {
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        organization_id: ORGANIZATION_ID,
        next_due_at: null,
      },
      surface: 'chrome-extension-chat',
      instanceId: 'instance-1',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: TASK_ID,
        user_id: USER_ID,
        organization_id: ORGANIZATION_ID,
        metadata: { claim_protocol: 2 },
      }),
    );
  });

  it('refuses an invalid agenda task organization before constructing a database query', async () => {
    await expect(
      claimRun(
        { id: TASK_ID, organization_id: '' },
        'chrome-extension-chat',
      ),
    ).resolves.toBeNull();
    expect(schedulerDb).not.toHaveBeenCalled();
  });

  it('copies the agenda task organization into its direct run insert', async () => {
    const run = {
      id: '44444444-4444-4444-8444-444444444444',
      task_id: TASK_ID,
      user_id: USER_ID,
      status: 'claimed',
      surface: 'chrome-extension-chat',
      output_ref: null,
      due_at: new Date().toISOString(),
      claimed_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      claim_token: '55555555-5555-4555-8555-555555555555',
      claim_expires_at: new Date().toISOString(),
      result_summary: null,
      error_message: null,
      result_metadata: null,
      created_at: new Date().toISOString(),
    };
    const single = vi.fn().mockResolvedValue({ data: run, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(schedulerDb).mockReturnValue({ from } as never);

    await claimRun(
      { id: TASK_ID, organization_id: ORGANIZATION_ID },
      'chrome-extension-chat',
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: TASK_ID,
        organization_id: ORGANIZATION_ID,
        metadata: { claim_protocol: 2 },
      }),
    );
  });
});
