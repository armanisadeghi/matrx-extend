/**
 * createTask names the organization the schedule is created in.
 *
 * `public.create_agent_task` refuses a NULL `p_organization_id`
 * (`organization_required`) and `scheduler.sch_agent_task.organization_id`
 * is NOT NULL — so a create that does not send the person's organization
 * fails every time. The id must come from the ONE resolver (which holds on
 * the picker), never be omitted, and a failed resolve must stop the write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  organization: 'org-chosen-on-this-device' as string | Error,
}));

vi.mock('@/lib/org/active-org', () => ({
  requireActiveOrganizationId: vi.fn(async () => {
    if (state.organization instanceof Error) throw state.organization;
    return state.organization;
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return { data: 'task-1', error: null };
    },
  }),
}));

// getTask reads the created row back through the scheduler schema.
vi.mock('@/lib/supabase/schemas', () => {
  const row = {
    id: 'task-1',
    organization_id: 'org-chosen-on-this-device',
    kind: 'agent',
    title: 'Daily brief',
    description: null,
    queue: 'default',
    surfaces: ['any'],
    enabled: true,
    expires_at: null,
    tags: [],
    next_due_at: null,
    last_run_at: null,
    created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-26T00:00:00Z',
    user_id: 'user-1',
    sch_agent_task: {
      agent_id: null,
      prompt: 'Summarize',
      variables: {},
      persistent_conversation_id: null,
      auth_mode: 'ask',
      max_runtime_seconds: 600,
      max_concurrent: 1,
    },
    sch_trigger: [
      {
        id: 'trig-1',
        type: 'interval',
        config: { type: 'interval', every_seconds: 3600 },
        enabled: true,
        next_due_at: null,
      },
    ],
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return {
    schedulerDb: () => ({ from: () => builder }),
    schedulerMachineryDb: () => ({ from: () => builder }),
  };
});

import { createTask } from './queries';

const input = {
  title: 'Daily brief',
  prompt: 'Summarize',
  trigger_type: 'interval' as const,
  trigger_config: { type: 'interval' as const, every_seconds: 3600 },
};

describe('createTask organization', () => {
  beforeEach(() => {
    state.rpcCalls = [];
    state.organization = 'org-chosen-on-this-device';
  });

  it('passes the resolved organization to create_agent_task', async () => {
    await createTask(input).catch(() => undefined);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]?.fn).toBe('create_agent_task');
    expect(state.rpcCalls[0]?.args.p_organization_id).toBe('org-chosen-on-this-device');
  });

  it('writes nothing when no organization could be resolved', async () => {
    state.organization = new Error('No organization is selected for this browser.');
    await expect(createTask(input)).rejects.toThrow(/organization/i);
    expect(state.rpcCalls).toHaveLength(0);
  });
});
