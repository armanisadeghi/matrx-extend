import { claimRun } from '@/lib/agenda/queries';
import { claimTask } from '@/lib/scheduler-client/claim';
import { schedulerDb } from '@/lib/supabase/schemas';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/schemas', () => ({
  schedulerDb: vi.fn(),
  schedulerMachineryDb: vi.fn(),
}));

/**
 * 🚨 WHAT THIS FILE ASSERTS CHANGED ON 2026-09-21 (SECURITY-SWEEP), AND IT GOT STRONGER.
 *
 * Both claim paths used to INSERT a `sch_run` row directly, carrying a `claim_token` the
 * extension minted with `crypto.randomUUID()`. Holding a run's claim token IS holding the run
 * — `completeRun`, `failRun` and `markRunRunning` all gate their UPDATE on it — so a client
 * that chose the token could write one it already knew onto somebody else's run and then
 * finish, fail or re-point their scheduled work.
 *
 * Both now call `scheduler.sch_run_claim` (SECURITY DEFINER), which MINTS the token and takes
 * `organization_id`, `user_id`, `due_at` and `queue` from the PERSISTED task. So the old
 * assertion — "the client copies the task's organization into the insert" — is replaced by a
 * stronger one: **the client does not send an organization at all**, and cannot, because the
 * door reads it from the task. A trigger on `scheduler.sch_run` refuses any client INSERT
 * carrying a token, so there is no second way back in.
 *
 * The local "refuse an invalid organization before touching the database" clauses are kept:
 * they are still the fastest, clearest refusal, and they still must not reach the network.
 */

const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '11111111-1111-4111-8111-111111111111';

/** A client whose `.schema('scheduler').rpc(...).single()` resolves to a claimed run. */
function testClient(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  const single = vi.fn().mockResolvedValue({
    data: { id: '44444444-4444-4444-8444-444444444444' },
    error: null,
  });
  rpc.mockReturnValue({ single });
  const schema = vi.fn().mockReturnValue({ rpc });
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

  it('claims through the door and sends no organization, no user and no token', async () => {
    const rpc = vi.fn();
    const client = testClient(rpc);

    await claimTask(client, {
      task: {
        id: TASK_ID,
        user_id: USER_ID,
        organization_id: ORGANIZATION_ID,
        next_due_at: null,
      },
      surface: 'chrome-extension-chat',
      instanceId: 'instance-1',
      leaseSeconds: 600,
    });

    expect(rpc).toHaveBeenCalledWith('sch_run_claim', {
      p_task_id: TASK_ID,
      p_surface: 'chrome-extension-chat',
      p_trigger_id: null,
      p_queue: null,
      p_lease_seconds: 600,
    });
    // The point of the change: none of these leave the client any more.
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).not.toHaveProperty('claim_token');
    expect(args).not.toHaveProperty('p_organization_id');
    expect(args).not.toHaveProperty('p_user_id');
  });

  it('refuses an invalid agenda task organization before constructing a database query', async () => {
    await expect(
      claimRun({ id: TASK_ID, organization_id: '' }, 'chrome-extension-chat'),
    ).resolves.toBeNull();
    expect(schedulerDb).not.toHaveBeenCalled();
  });

  it('claims the agenda task through the same door', async () => {
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
    const rpc = vi.fn().mockReturnValue({ single });
    vi.mocked(schedulerDb).mockReturnValue({ rpc } as never);

    await claimRun({ id: TASK_ID, organization_id: ORGANIZATION_ID }, 'chrome-extension-chat');

    expect(rpc).toHaveBeenCalledWith('sch_run_claim', {
      p_task_id: TASK_ID,
      p_surface: 'chrome-extension-chat',
      p_trigger_id: null,
      p_queue: 'default',
      p_lease_seconds: 600,
    });
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args).not.toHaveProperty('claim_token');
    expect(args).not.toHaveProperty('organization_id');
  });
});
