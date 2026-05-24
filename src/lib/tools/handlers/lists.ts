/**
 * Plan / Tasks / User-Todos mega-tools.
 *
 *  `tasks`       — agent owns this list; manages live progress.
 *  `user_todos`  — agent assigns items TO the user; user checks them off.
 *
 * Both are per-conversation. Both are 'action' tier (cheap local writes).
 * `tierFor` downgrades read-only actions ('list') to 'read' so the
 * dispatcher doesn't require approval just to read state.
 *
 * `update_plan` (in handlers/user.ts) already covers the plan-creation
 * flow; this file only exposes the management surface. The plan is
 * persisted to storage inside the ask-card-resolved flow — see
 * src/lib/tools/handlers/user.ts ::update_plan.
 */

import {
  addTasks,
  addUserTodo,
  clearAllTasks,
  clearCompletedTasks,
  clearDoneUserTodos,
  listTasks,
  listUserTodos,
  removeTask,
  removeUserTodo,
  reorderTasks,
  updateTask,
  updateUserTodo,
} from '@/lib/lists/storage';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { z } from 'zod';

// ─── tasks (agent's own list) ───────────────────────────────────────────────

const TaskItemSchema = z.object({
  title: z.string().min(1).max(200),
  status: z.enum(['pending', 'in_progress', 'done', 'blocked', 'skipped']).optional(),
  note: z.string().max(500).optional(),
});

const TasksArgs = z
  .object({
    action: z.enum([
      'add',
      'list',
      'set_status',
      'update',
      'remove',
      'reorder',
      'clear_completed',
      'clear_all',
    ]),
    /** For 'add' — single item shortcut. */
    title: z.string().min(1).max(200).optional(),
    /** For 'add' — bulk. Either `title` OR `items` is required. */
    items: z.array(TaskItemSchema).max(40).optional(),
    /** For set_status / update / remove. */
    id: z.string().optional(),
    /** For set_status / update. */
    status: z.enum(['pending', 'in_progress', 'done', 'blocked', 'skipped']).optional(),
    /** For update. Pass null to clear. */
    note: z.string().max(500).nullable().optional(),
    /** For reorder. */
    ids: z.array(z.string()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'add' && !v.title && (!v.items || v.items.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'add' requires `title` or non-empty `items`",
        path: ['action'],
      });
    }
    if ((v.action === 'set_status' || v.action === 'update' || v.action === 'remove') && !v.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `'${v.action}' requires \`id\``, path: ['action'] });
    }
    if (v.action === 'set_status' && !v.status) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "'set_status' requires `status`", path: ['action'] });
    }
    if (v.action === 'reorder' && (!v.ids || v.ids.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "'reorder' requires non-empty `ids`", path: ['action'] });
    }
  });
type TasksArgs = z.infer<typeof TasksArgs>;

const TASKS_READ_ACTIONS = new Set<TasksArgs['action']>(['list']);

export const tasks: ToolHandler<TasksArgs, unknown> = {
  name: 'tasks',
  tier: 'action',
  tierFor: (args): ToolTier => (TASKS_READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  argsSchema: TasksArgs,
  run: async (args, ctx) => {
    const conv = ctx.conversationId;
    if (!conv) return { ok: false, reason: 'No active conversation' };

    if (args.action === 'list') {
      const tasks = await listTasks(conv);
      return { ok: true, tasks };
    }
    if (args.action === 'add') {
      const items = args.items ?? [{ title: args.title!, status: args.status, note: args.note ?? undefined }];
      const created = await addTasks(conv, items, 'agent');
      return { ok: true, created };
    }
    if (args.action === 'set_status') {
      const updated = await updateTask(conv, args.id!, { status: args.status });
      if (!updated) return { ok: false, reason: `No task ${args.id}` };
      return { ok: true, task: updated };
    }
    if (args.action === 'update') {
      const updated = await updateTask(conv, args.id!, {
        title: args.title,
        status: args.status,
        note: args.note,
      });
      if (!updated) return { ok: false, reason: `No task ${args.id}` };
      return { ok: true, task: updated };
    }
    if (args.action === 'remove') {
      const ok = await removeTask(conv, args.id!);
      return ok ? { ok: true, removed: args.id } : { ok: false, reason: `No task ${args.id}` };
    }
    if (args.action === 'reorder') {
      const list = await reorderTasks(conv, args.ids!);
      return { ok: true, tasks: list };
    }
    if (args.action === 'clear_completed') {
      const removed = await clearCompletedTasks(conv);
      return { ok: true, removed_count: removed };
    }
    if (args.action === 'clear_all') {
      const removed = await clearAllTasks(conv);
      return { ok: true, removed_count: removed };
    }
    return { ok: false, reason: `Unknown tasks action: ${args.action as string}` };
  },
};

// ─── user_todos (model assigns to user) ─────────────────────────────────────

const UserTodosArgs = z
  .object({
    action: z.enum(['add', 'list', 'update', 'remove', 'mark_done', 'clear_done']),
    /** For add / update. */
    title: z.string().min(1).max(200).optional(),
    /** Why the agent is asking. One short line. */
    context: z.string().max(300).nullable().optional(),
    /** Optional human hint, e.g. "by Thursday". */
    due: z.string().max(80).nullable().optional(),
    /** For update / remove / mark_done. */
    id: z.string().optional(),
    /** For 'add' only — suppress the Chrome notification. Default false. */
    silent: z.boolean().optional(),
    /** For mark_done — set the done flag. Defaults true; pass false to un-check. */
    done: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'add' && !v.title) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "'add' requires `title`", path: ['action'] });
    }
    if ((v.action === 'update' || v.action === 'remove' || v.action === 'mark_done') && !v.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `'${v.action}' requires \`id\``, path: ['action'] });
    }
  });
type UserTodosArgs = z.infer<typeof UserTodosArgs>;

const USER_TODOS_READ_ACTIONS = new Set<UserTodosArgs['action']>(['list']);

async function fireTodoNotification(title: string, context: string | undefined): Promise<void> {
  try {
    if (!chrome.notifications?.create) return;
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: 'New todo from your agent',
      message: context ? `${title}\n\n${context}` : title,
      priority: 1,
    });
  } catch {
    /* permissions / API absent — in-panel card is the fallback */
  }
}

export const user_todos: ToolHandler<UserTodosArgs, unknown> = {
  name: 'user_todos',
  tier: 'action',
  tierFor: (args): ToolTier => (USER_TODOS_READ_ACTIONS.has(args.action) ? 'read' : 'action'),
  argsSchema: UserTodosArgs,
  run: async (args, ctx) => {
    const conv = ctx.conversationId;
    if (!conv) return { ok: false, reason: 'No active conversation' };

    if (args.action === 'list') {
      const todos = await listUserTodos(conv);
      return { ok: true, user_todos: todos };
    }
    if (args.action === 'add') {
      const todo = await addUserTodo(conv, {
        title: args.title!,
        context: args.context ?? undefined,
        due: args.due ?? undefined,
      });
      if (!args.silent) {
        void fireTodoNotification(todo.title, todo.context);
      }
      return { ok: true, todo };
    }
    if (args.action === 'update') {
      const updated = await updateUserTodo(conv, args.id!, {
        title: args.title,
        context: args.context,
        due: args.due,
      });
      if (!updated) return { ok: false, reason: `No todo ${args.id}` };
      return { ok: true, todo: updated };
    }
    if (args.action === 'remove') {
      const ok = await removeUserTodo(conv, args.id!);
      return ok ? { ok: true, removed: args.id } : { ok: false, reason: `No todo ${args.id}` };
    }
    if (args.action === 'mark_done') {
      const updated = await updateUserTodo(conv, args.id!, { done: args.done ?? true });
      if (!updated) return { ok: false, reason: `No todo ${args.id}` };
      return { ok: true, todo: updated };
    }
    if (args.action === 'clear_done') {
      const removed = await clearDoneUserTodos(conv);
      return { ok: true, removed_count: removed };
    }
    return { ok: false, reason: `Unknown user_todos action: ${args.action as string}` };
  },
};

export const lists_handlers = [tasks, user_todos];
