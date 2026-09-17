import { getPlan, listTasks, listUserTodos } from '@/lib/lists/storage';

export interface ConversationSliceFailure {
  slice: 'current_plan' | 'task_list' | 'user_todos';
  message: string;
}

export interface ConversationContextSlices {
  current_plan?: Record<string, unknown>;
  task_list?: Array<Record<string, unknown>>;
  user_todos?: {
    open: Array<Record<string, unknown>>;
    recent_done: Array<Record<string, unknown>>;
  };
  failures: ConversationSliceFailure[];
}

export async function loadConversationContextSlices(
  conversationId: string,
): Promise<ConversationContextSlices> {
  const [planResult, taskResult, todoResult] = await Promise.allSettled([
    getPlan(conversationId),
    listTasks(conversationId),
    listUserTodos(conversationId),
  ]);
  const result: ConversationContextSlices = { failures: [] };
  const recordFailure = (
    slice: ConversationSliceFailure['slice'],
    rejected: PromiseRejectedResult,
  ) => {
    result.failures.push({
      slice,
      message: rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason),
    });
  };

  if (planResult.status === 'rejected') recordFailure('current_plan', planResult);
  if (taskResult.status === 'rejected') recordFailure('task_list', taskResult);
  if (todoResult.status === 'rejected') recordFailure('user_todos', todoResult);

  const plan = planResult.status === 'fulfilled' ? planResult.value : null;
  if (plan) {
    result.current_plan = {
      title: plan.title,
      steps: plan.steps,
      status: plan.status,
      reasoning: plan.reasoning,
      domains: plan.domains,
      estimated_minutes: plan.estimated_minutes,
      updated_at: plan.updated_at,
    };
  }
  const taskList = taskResult.status === 'fulfilled' ? taskResult.value : [];
  if (taskList.length) {
    result.task_list = taskList.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      note: task.note,
    }));
  }
  const userTodos = todoResult.status === 'fulfilled' ? todoResult.value : [];
  const open = userTodos.filter((todo) => !todo.done);
  const recentDone = userTodos
    .filter((todo) => todo.done)
    .sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0))
    .slice(0, 5);
  if (open.length || recentDone.length) {
    result.user_todos = {
      open: open.map((todo) => ({
        id: todo.id,
        title: todo.title,
        context: todo.context,
        due: todo.due,
      })),
      recent_done: recentDone.map((todo) => ({
        id: todo.id,
        title: todo.title,
        done_at: todo.done_at,
      })),
    };
  }
  return result;
}
