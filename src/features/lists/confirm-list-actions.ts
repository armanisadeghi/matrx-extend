/**
 * The confirmed deletes for the Lists feature — ONE copy of the consequence
 * for the two surfaces that render the same data (the Lists hub and the
 * per-chat TaskPanel drawer). Both call these; neither reaches the storage
 * operations directly. The guard (`tests/unit/destructive-confirm-guard.test.ts`)
 * checks that the operations below are only ever called inside `run`.
 *
 * Law: `common-docs/policies/destructive-and-expensive-actions.md`.
 */

import { confirmDestructive } from '@/lib/destructive/confirm';
import {
  clearCompletedTasks,
  clearDoneUserTodos,
  removeTask,
  removeUserTodo,
} from '@/lib/lists/storage';
import type { Task, UserTodo } from '@/lib/lists/types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const isFinishedTask = (t: Task): boolean => t.status === 'done' || t.status === 'skipped';

export function confirmRemoveTask(conversationId: string, task: Task): Promise<boolean> {
  return confirmDestructive({
    title: `Remove "${task.title}"?`,
    consequence:
      'The task is removed from this conversation for good, along with anything the agent noted against it. This cannot be undone.',
    ...(!isFinishedTask(task) && {
      alternative:
        'To keep the record but take it off the to-do list, cancel and mark it skipped instead.',
    }),
    confirmLabel: 'Remove',
    run: async () => {
      await removeTask(conversationId, task.id);
    },
  });
}

export function confirmRemoveUserTodo(conversationId: string, todo: UserTodo): Promise<boolean> {
  return confirmDestructive({
    title: `Remove "${todo.title}"?`,
    consequence: 'The to-do is deleted from this conversation. This cannot be undone.',
    ...(!todo.done && {
      alternative: 'To keep it in the list but out of the way, cancel and tick it off instead.',
    }),
    confirmLabel: 'Remove',
    run: async () => {
      await removeUserTodo(conversationId, todo.id);
    },
  });
}

export function confirmClearCompletedTasks(
  conversationId: string,
  tasks: Task[],
): Promise<boolean> {
  const finished = tasks.filter(isFinishedTask);
  return confirmDestructive({
    title: `Clear ${plural(finished.length, 'finished task', 'finished tasks')}?`,
    consequence:
      `Every done and skipped task in this conversation — ${finished.length} in all — is deleted, including the agent's notes on each. ` +
      'Open tasks are not touched. This cannot be undone.',
    confirmLabel: `Clear ${finished.length}`,
    run: async () => {
      await clearCompletedTasks(conversationId);
    },
  });
}

export function confirmClearDoneUserTodos(
  conversationId: string,
  todos: UserTodo[],
): Promise<boolean> {
  const done = todos.filter((t) => t.done);
  return confirmDestructive({
    title: `Clear ${plural(done.length, 'done to-do', 'done to-dos')}?`,
    consequence:
      `Every to-do you have ticked off in this conversation — ${done.length} in all — is deleted. ` +
      'Unfinished to-dos are not touched. This cannot be undone.',
    confirmLabel: `Clear ${done.length}`,
    run: async () => {
      await clearDoneUserTodos(conversationId);
    },
  });
}
