import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getPlan: vi.fn(),
  listTasks: vi.fn(),
  listUserTodos: vi.fn(),
}));

vi.mock('@/lib/lists/storage', () => storage);

describe('conversation context slices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the healthy slices when the agent-task read times out', async () => {
    storage.getPlan.mockResolvedValue({
      title: 'Ship it',
      steps: [],
      status: 'active',
      reasoning: null,
      domains: [],
      estimated_minutes: null,
      updated_at: 123,
    });
    storage.listTasks.mockRejectedValue(
      new Error('Failed to load agent tasks: canceling statement due to statement timeout'),
    );
    storage.listUserTodos.mockResolvedValue([
      {
        id: 'todo-1',
        title: 'Keep this',
        done: false,
        context: null,
        due: null,
        done_at: null,
      },
    ]);

    const { loadConversationContextSlices } = await import(
      '@/lib/chat/context/conversation-slices'
    );
    const result = await loadConversationContextSlices('conversation-1');

    expect(result.current_plan).toMatchObject({ title: 'Ship it', updated_at: 123 });
    expect(result.task_list).toBeUndefined();
    expect(result.user_todos).toEqual({
      open: [
        {
          id: 'todo-1',
          title: 'Keep this',
          context: null,
          due: null,
        },
      ],
      recent_done: [],
    });
    expect(result.failures).toEqual([
      {
        slice: 'task_list',
        message: 'Failed to load agent tasks: canceling statement due to statement timeout',
      },
    ]);
  });

  it('keeps tasks when only the local plan read fails', async () => {
    storage.getPlan.mockRejectedValue(new Error('local plan cache unavailable'));
    storage.listTasks.mockResolvedValue([
      { id: 'task-2', title: 'Keep task', status: 'pending', note: null },
    ]);
    storage.listUserTodos.mockResolvedValue([]);

    const { loadConversationContextSlices } = await import(
      '@/lib/chat/context/conversation-slices'
    );
    const result = await loadConversationContextSlices('conversation-2');

    expect(result.current_plan).toBeUndefined();
    expect(result.task_list).toEqual([
      { id: 'task-2', title: 'Keep task', status: 'pending', note: null },
    ]);
    expect(result.failures).toEqual([
      { slice: 'current_plan', message: 'local plan cache unavailable' },
    ]);
  });
});
