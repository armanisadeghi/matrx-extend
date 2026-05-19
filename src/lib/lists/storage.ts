/**
 * chrome.storage.local persistence for plan / tasks / user_todos.
 *
 * Storage layout — three top-level maps, each keyed by conversation_id:
 *   matrx.lists.plans       → Record<conversation_id, Plan>
 *   matrx.lists.tasks       → Record<conversation_id, Task[]>
 *   matrx.lists.user_todos  → Record<conversation_id, UserTodo[]>
 *
 * Map shape (vs per-conversation keys) trades a slightly larger write
 * payload for trivial aggregate-view iteration without a secondary
 * index. Volumes here are tiny — a few conversations × a handful of
 * items each — so the simpler shape wins.
 *
 * Every successful write fires the LISTS_CHANGED broadcast so the
 * sidepanel store + any open tabs refresh without polling.
 */

import { CHANNELS } from '@/lib/messaging/schemas';
import { broadcast } from '@/lib/messaging/native';
import type {
  ConversationListsSummary,
  Plan,
  PlanStatus,
  Task,
  TaskStatus,
  UserTodo,
} from '@/lib/lists/types';

const PLAN_KEY = 'matrx.lists.plans';
const TASKS_KEY = 'matrx.lists.tasks';
const TODOS_KEY = 'matrx.lists.user_todos';

type PlanMap = Record<string, Plan>;
type TaskMap = Record<string, Task[]>;
type TodoMap = Record<string, UserTodo[]>;

// ─── core map I/O ───────────────────────────────────────────────────────────

async function readPlans(): Promise<PlanMap> {
  const r = await chrome.storage.local.get([PLAN_KEY]);
  const v = r[PLAN_KEY];
  return v && typeof v === 'object' ? (v as PlanMap) : {};
}
async function readTasks(): Promise<TaskMap> {
  const r = await chrome.storage.local.get([TASKS_KEY]);
  const v = r[TASKS_KEY];
  return v && typeof v === 'object' ? (v as TaskMap) : {};
}
async function readTodos(): Promise<TodoMap> {
  const r = await chrome.storage.local.get([TODOS_KEY]);
  const v = r[TODOS_KEY];
  return v && typeof v === 'object' ? (v as TodoMap) : {};
}

function notify(kind: 'plan' | 'tasks' | 'user_todos', conversationId: string): void {
  void broadcast(CHANNELS.LISTS_CHANGED, { kind, conversation_id: conversationId });
}

// ─── id helpers ─────────────────────────────────────────────────────────────

export function makeTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `t_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function makeTodoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `todo_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── plan ───────────────────────────────────────────────────────────────────

export async function getPlan(conversationId: string): Promise<Plan | null> {
  const plans = await readPlans();
  return plans[conversationId] ?? null;
}

export async function savePlan(plan: Plan): Promise<Plan> {
  const plans = await readPlans();
  const existing = plans[plan.conversation_id];
  const now = Date.now();
  const next: Plan = {
    ...plan,
    created_at: existing?.created_at ?? plan.created_at ?? now,
    updated_at: now,
  };
  plans[plan.conversation_id] = next;
  await chrome.storage.local.set({ [PLAN_KEY]: plans });
  notify('plan', plan.conversation_id);
  return next;
}

export async function setPlanStatus(
  conversationId: string,
  status: PlanStatus,
): Promise<Plan | null> {
  const plans = await readPlans();
  const p = plans[conversationId];
  if (!p) return null;
  p.status = status;
  p.updated_at = Date.now();
  await chrome.storage.local.set({ [PLAN_KEY]: plans });
  notify('plan', conversationId);
  return p;
}

export async function clearPlan(conversationId: string): Promise<void> {
  const plans = await readPlans();
  if (!plans[conversationId]) return;
  delete plans[conversationId];
  await chrome.storage.local.set({ [PLAN_KEY]: plans });
  notify('plan', conversationId);
}

// ─── tasks ──────────────────────────────────────────────────────────────────

export async function listTasks(conversationId: string): Promise<Task[]> {
  const tasks = await readTasks();
  return (tasks[conversationId] ?? []).slice().sort((a, b) => a.order - b.order);
}

export async function addTasks(
  conversationId: string,
  items: Array<{ title: string; status?: TaskStatus; note?: string }>,
  createdBy: 'agent' | 'user' = 'agent',
): Promise<Task[]> {
  if (!items.length) return [];
  const map = await readTasks();
  const list = map[conversationId] ?? [];
  let nextOrder = list.reduce((m, t) => Math.max(m, t.order), 0) + 1;
  const now = Date.now();
  const created: Task[] = items.map((it) => ({
    id: makeTaskId(),
    conversation_id: conversationId,
    title: it.title,
    status: it.status ?? 'pending',
    note: it.note,
    order: nextOrder++,
    created_by: createdBy,
    created_at: now,
    updated_at: now,
  }));
  map[conversationId] = [...list, ...created];
  await chrome.storage.local.set({ [TASKS_KEY]: map });
  notify('tasks', conversationId);
  return created;
}

export async function updateTask(
  conversationId: string,
  id: string,
  patch: { title?: string; status?: TaskStatus; note?: string | null },
): Promise<Task | null> {
  const map = await readTasks();
  const list = map[conversationId];
  if (!list) return null;
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const current = list[idx]!;
  const next: Task = {
    ...current,
    title: patch.title ?? current.title,
    status: patch.status ?? current.status,
    note:
      patch.note === undefined
        ? current.note
        : patch.note === null
          ? undefined
          : patch.note,
    updated_at: Date.now(),
  };
  list[idx] = next;
  await chrome.storage.local.set({ [TASKS_KEY]: map });
  notify('tasks', conversationId);
  return next;
}

export async function removeTask(conversationId: string, id: string): Promise<boolean> {
  const map = await readTasks();
  const list = map[conversationId];
  if (!list) return false;
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  map[conversationId] = next;
  await chrome.storage.local.set({ [TASKS_KEY]: map });
  notify('tasks', conversationId);
  return true;
}

export async function reorderTasks(conversationId: string, ids: string[]): Promise<Task[]> {
  const map = await readTasks();
  const list = map[conversationId];
  if (!list || !ids.length) return list ?? [];
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const now = Date.now();
  for (const t of list) {
    const i = indexOf.get(t.id);
    if (i != null) {
      t.order = i + 1;
      t.updated_at = now;
    }
  }
  await chrome.storage.local.set({ [TASKS_KEY]: map });
  notify('tasks', conversationId);
  return list.slice().sort((a, b) => a.order - b.order);
}

export async function clearCompletedTasks(conversationId: string): Promise<number> {
  const map = await readTasks();
  const list = map[conversationId];
  if (!list) return 0;
  const next = list.filter((t) => t.status !== 'done' && t.status !== 'skipped');
  const removed = list.length - next.length;
  if (!removed) return 0;
  map[conversationId] = next;
  await chrome.storage.local.set({ [TASKS_KEY]: map });
  notify('tasks', conversationId);
  return removed;
}

export async function clearAllTasks(conversationId: string): Promise<number> {
  const map = await readTasks();
  const removed = map[conversationId]?.length ?? 0;
  if (!removed) return 0;
  delete map[conversationId];
  await chrome.storage.local.set({ [TASKS_KEY]: map });
  notify('tasks', conversationId);
  return removed;
}

// ─── user todos ─────────────────────────────────────────────────────────────

export async function listUserTodos(conversationId: string): Promise<UserTodo[]> {
  const map = await readTodos();
  return map[conversationId] ?? [];
}

export async function addUserTodo(
  conversationId: string,
  item: { title: string; context?: string; due?: string },
): Promise<UserTodo> {
  const map = await readTodos();
  const list = map[conversationId] ?? [];
  const todo: UserTodo = {
    id: makeTodoId(),
    conversation_id: conversationId,
    title: item.title,
    context: item.context,
    due: item.due,
    done: false,
    created_at: Date.now(),
  };
  map[conversationId] = [...list, todo];
  await chrome.storage.local.set({ [TODOS_KEY]: map });
  notify('user_todos', conversationId);
  return todo;
}

export async function updateUserTodo(
  conversationId: string,
  id: string,
  patch: { title?: string; context?: string | null; due?: string | null; done?: boolean },
): Promise<UserTodo | null> {
  const map = await readTodos();
  const list = map[conversationId];
  if (!list) return null;
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  const cur = list[idx]!;
  const wasDone = cur.done;
  const next: UserTodo = {
    ...cur,
    title: patch.title ?? cur.title,
    context:
      patch.context === undefined ? cur.context : patch.context === null ? undefined : patch.context,
    due: patch.due === undefined ? cur.due : patch.due === null ? undefined : patch.due,
    done: patch.done ?? cur.done,
    done_at:
      patch.done === true && !wasDone
        ? Date.now()
        : patch.done === false
          ? undefined
          : cur.done_at,
  };
  list[idx] = next;
  await chrome.storage.local.set({ [TODOS_KEY]: map });
  notify('user_todos', conversationId);
  return next;
}

export async function removeUserTodo(conversationId: string, id: string): Promise<boolean> {
  const map = await readTodos();
  const list = map[conversationId];
  if (!list) return false;
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  map[conversationId] = next;
  await chrome.storage.local.set({ [TODOS_KEY]: map });
  notify('user_todos', conversationId);
  return true;
}

export async function clearDoneUserTodos(conversationId: string): Promise<number> {
  const map = await readTodos();
  const list = map[conversationId];
  if (!list) return 0;
  const next = list.filter((t) => !t.done);
  const removed = list.length - next.length;
  if (!removed) return 0;
  map[conversationId] = next;
  await chrome.storage.local.set({ [TODOS_KEY]: map });
  notify('user_todos', conversationId);
  return removed;
}

// ─── aggregate view (powers ListsHubView) ───────────────────────────────────

export async function getAllConversationLists(): Promise<ConversationListsSummary[]> {
  const [plans, tasks, todos] = await Promise.all([readPlans(), readTasks(), readTodos()]);
  const ids = new Set<string>([
    ...Object.keys(plans),
    ...Object.keys(tasks),
    ...Object.keys(todos),
  ]);
  const out: ConversationListsSummary[] = [];
  for (const id of ids) {
    const plan = plans[id];
    const t = tasks[id] ?? [];
    const u = todos[id] ?? [];
    const lastActivity = Math.max(
      plan?.updated_at ?? 0,
      ...t.map((x) => x.updated_at),
      ...u.map((x) => (x.done_at ?? x.created_at)),
      0,
    );
    out.push({
      conversation_id: id,
      has_plan: !!plan,
      plan_title: plan?.title,
      plan_status: plan?.status,
      tasks_total: t.length,
      tasks_in_progress: t.filter((x) => x.status === 'in_progress').length,
      tasks_done: t.filter((x) => x.status === 'done').length,
      user_todos_open: u.filter((x) => !x.done).length,
      user_todos_done: u.filter((x) => x.done).length,
      last_activity: lastActivity,
    });
  }
  out.sort((a, b) => b.last_activity - a.last_activity);
  return out;
}

/** Wipe everything for one conversation. Used when the user clears a chat. */
export async function purgeConversation(conversationId: string): Promise<void> {
  const [plans, tasks, todos] = await Promise.all([readPlans(), readTasks(), readTodos()]);
  let changed = false;
  if (plans[conversationId]) {
    delete plans[conversationId];
    changed = true;
  }
  if (tasks[conversationId]) {
    delete tasks[conversationId];
    changed = true;
  }
  if (todos[conversationId]) {
    delete todos[conversationId];
    changed = true;
  }
  if (!changed) return;
  await chrome.storage.local.set({
    [PLAN_KEY]: plans,
    [TASKS_KEY]: tasks,
    [TODOS_KEY]: todos,
  });
  notify('plan', conversationId);
  notify('tasks', conversationId);
  notify('user_todos', conversationId);
}
