/**
 * Plan / User-Todos mega-tools.
 *
 *  `user_todos`  — agent assigns items TO the user; user checks them off.
 *
 * User todos are per-conversation and action tier (cheap local writes).
 * `tierFor` downgrades read-only actions ('list') to 'read' so the
 * dispatcher doesn't require approval just to read state.
 *
 * `tasks` is intentionally absent: aidream is its canonical executor and
 * writes `chat.agent_task`. The extension task panel reads that shared table
 * directly; it must never advertise a second client executor.
 *
 * `update_plan` (in handlers/user.ts) already covers the plan-creation
 * flow; this file only exposes the management surface. The plan is
 * persisted to storage inside the ask-card-resolved flow — see
 * src/lib/tools/handlers/user.ts ::update_plan.
 */

import {
  addUserTodo,
  clearDoneUserTodos,
  listUserTodos,
  removeUserTodo,
  updateUserTodo,
} from '@/lib/lists/storage';
import type { ToolHandler, ToolTier } from '@/lib/tools/types';
import { z } from 'zod';

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
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "'add' requires `title`",
        path: ['action'],
      });
    }
    if ((v.action === 'update' || v.action === 'remove' || v.action === 'mark_done') && !v.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `'${v.action}' requires \`id\``,
        path: ['action'],
      });
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
      if (!args.title) return { ok: false, reason: 'user_todos.add requires `title`' };
      const todo = await addUserTodo(conv, {
        title: args.title,
        ...(args.context != null && { context: args.context }),
        ...(args.due != null && { due: args.due }),
      });
      if (!args.silent) {
        void fireTodoNotification(todo.title, todo.context);
      }
      return { ok: true, todo };
    }
    if (args.action === 'update') {
      if (!args.id) return { ok: false, reason: 'user_todos.update requires `id`' };
      const updated = await updateUserTodo(conv, args.id, {
        ...(args.title !== undefined && { title: args.title }),
        ...(args.context !== undefined && { context: args.context }),
        ...(args.due !== undefined && { due: args.due }),
      });
      if (!updated) return { ok: false, reason: `No todo ${args.id}` };
      return { ok: true, todo: updated };
    }
    if (args.action === 'remove') {
      if (!args.id) return { ok: false, reason: 'user_todos.remove requires `id`' };
      const ok = await removeUserTodo(conv, args.id);
      return ok ? { ok: true, removed: args.id } : { ok: false, reason: `No todo ${args.id}` };
    }
    if (args.action === 'mark_done') {
      if (!args.id) return { ok: false, reason: 'user_todos.mark_done requires `id`' };
      const updated = await updateUserTodo(conv, args.id, { done: args.done ?? true });
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

export const lists_handlers = [user_todos];
