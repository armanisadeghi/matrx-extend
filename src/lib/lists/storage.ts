/**
 * Persistence for plan / tasks / user_todos.
 *
 * Plans and user todos are small extension-local maps keyed by conversation_id:
 *   matrx.lists.plans       → Record<conversation_id, Plan>
 *   matrx.lists.user_todos  → Record<conversation_id, UserTodo[]>
 *
 * Agent tasks live in `chat.agent_task`, shared with aidream's canonical
 * server-executed `tasks` tool. The extension reads and edits that table
 * directly so its panel and the server always show the same task list.
 *
 * Map shape (vs per-conversation keys) trades a slightly larger local write
 * payload for trivial aggregate-view iteration without a secondary
 * index. Volumes here are tiny — a few conversations × a handful of
 * items each — so the simpler shape wins.
 *
 * Every successful write fires the LISTS_CHANGED broadcast so the
 * sidepanel store + any open tabs refresh without polling.
 */

import type {
  ConversationListsSummary,
  Plan,
  PlanStatus,
  Task,
  TaskStatus,
  UserTodo,
} from '@/lib/lists/types';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { chatDb } from '@/lib/supabase/schemas';

const PLAN_KEY = 'matrx.lists.plans';
const TODOS_KEY = 'matrx.lists.user_todos';

type PlanMap = Record<string, Plan>;
type TodoMap = Record<string, UserTodo[]>;

interface AgentTaskRow {
  id: string;
  conversation_id: string;
  title: string;
  status: TaskStatus;
  note: string | null;
  position: number;
  creator_kind: 'agent' | 'user';
  created_at: string;
  updated_at: string;
}

const AGENT_TASK_COLUMNS =
  'id,conversation_id,title,status,note,position,creator_kind,created_at,updated_at';

// ─── core map I/O ───────────────────────────────────────────────────────────

async function readPlans(): Promise<PlanMap> {
  const r = await chrome.storage.local.get([PLAN_KEY]);
  const v = r[PLAN_KEY];
  return v && typeof v === 'object' ? (v as PlanMap) : {};
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

function taskFromRow(row: AgentTaskRow): Task {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    title: row.title,
    status: row.status,
    ...(row.note !== null && { note: row.note }),
    order: row.position,
    creator_kind: row.creator_kind,
    created_at: Date.parse(row.created_at),
    updated_at: Date.parse(row.updated_at),
  };
}

function taskRows(data: unknown): Task[] {
  return ((data ?? []) as AgentTaskRow[]).map(taskFromRow);
}

export async function listTasks(conversationId: string): Promise<Task[]> {
  const { data, error } = await chatDb()
    .from('agent_task')
    .select(AGENT_TASK_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('position', { ascending: true });
  if (error) throw new Error(`Failed to load agent tasks: ${error.message}`);
  return taskRows(data);
}

export async function addTasks(
  conversationId: string,
  items: Array<{ title: string; status?: TaskStatus; note?: string | null }>,
  creatorKind: 'agent' | 'user' = 'agent',
): Promise<Task[]> {
  if (!items.length) return [];
  const existing = await listTasks(conversationId);
  let nextPosition = existing.reduce((max, task) => Math.max(max, task.order), -1) + 1;
  // No owner column is sent: `chat.agent_task` defers RLS to its conversation
  // and the cloud stamps ownership itself. Sending one would be a legacy write.
  const rows = items.map((item) => ({
    conversation_id: conversationId,
    title: item.title,
    status: item.status ?? 'pending',
    note: item.note ?? null,
    position: nextPosition++,
    creator_kind: creatorKind,
  }));
  const { data, error } = await chatDb().from('agent_task').insert(rows).select(AGENT_TASK_COLUMNS);
  if (error) throw new Error(`Failed to add agent tasks: ${error.message}`);
  notify('tasks', conversationId);
  return taskRows(data);
}

export async function updateTask(
  conversationId: string,
  id: string,
  patch: { title?: string; status?: TaskStatus; note?: string | null },
): Promise<Task | null> {
  const values: { title?: string; status?: TaskStatus; note?: string | null } = {};
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.note !== undefined) values.note = patch.note;
  if (Object.keys(values).length === 0) return null;
  const { data, error } = await chatDb()
    .from('agent_task')
    .update(values)
    .eq('conversation_id', conversationId)
    .eq('id', id)
    .select(AGENT_TASK_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Failed to update agent task: ${error.message}`);
  notify('tasks', conversationId);
  return data ? taskFromRow(data as AgentTaskRow) : null;
}

export async function removeTask(conversationId: string, id: string): Promise<boolean> {
  const { data, error } = await chatDb()
    .from('agent_task')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('id', id)
    .select('id');
  if (error) throw new Error(`Failed to remove agent task: ${error.message}`);
  const removed = (data ?? []).length > 0;
  if (!removed) return false;
  notify('tasks', conversationId);
  return true;
}

export async function reorderTasks(conversationId: string, ids: string[]): Promise<Task[]> {
  if (!ids.length) return listTasks(conversationId);
  await Promise.all(
    ids.map(async (id, index) => {
      const { error } = await chatDb()
        .from('agent_task')
        .update({ position: index + 1 })
        .eq('conversation_id', conversationId)
        .eq('id', id);
      if (error) throw new Error(`Failed to reorder agent task ${id}: ${error.message}`);
    }),
  );
  notify('tasks', conversationId);
  return listTasks(conversationId);
}

export async function clearCompletedTasks(conversationId: string): Promise<number> {
  const { data, error } = await chatDb()
    .from('agent_task')
    .delete()
    .eq('conversation_id', conversationId)
    .in('status', ['done', 'skipped'])
    .select('id');
  if (error) throw new Error(`Failed to clear completed agent tasks: ${error.message}`);
  const removed = (data ?? []).length;
  if (!removed) return 0;
  notify('tasks', conversationId);
  return removed;
}

export async function clearAllTasks(conversationId: string): Promise<number> {
  const { data, error } = await chatDb()
    .from('agent_task')
    .delete()
    .eq('conversation_id', conversationId)
    .select('id');
  if (error) throw new Error(`Failed to clear agent tasks: ${error.message}`);
  const removed = (data ?? []).length;
  if (!removed) return 0;
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
    ...(item.context !== undefined && { context: item.context }),
    ...(item.due !== undefined && { due: item.due }),
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
  const cur = list[idx];
  if (!cur) return null;
  const wasDone = cur.done;
  // Same footgun as updateTask above: build from a base that OMITS the
  // clearable optional keys, then only set them when the resolved value is
  // defined. Writing an explicit `undefined` here would be indistinguishable
  // from "field not stored" at read time but would still be a needless
  // persisted-merge foot-gun under EOPT.
  const { context: _curContext, due: _curDue, done_at: _curDoneAt, ...curRest } = cur;
  const next: UserTodo = {
    ...curRest,
    title: patch.title ?? cur.title,
    done: patch.done ?? cur.done,
  };
  const nextContext =
    patch.context === undefined ? cur.context : patch.context === null ? undefined : patch.context;
  if (nextContext !== undefined) next.context = nextContext;
  const nextDue = patch.due === undefined ? cur.due : patch.due === null ? undefined : patch.due;
  if (nextDue !== undefined) next.due = nextDue;
  const nextDoneAt =
    patch.done === true && !wasDone ? Date.now() : patch.done === false ? undefined : cur.done_at;
  if (nextDoneAt !== undefined) next.done_at = nextDoneAt;
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
  if (next.length === 0) delete map[conversationId];
  else map[conversationId] = next;
  await chrome.storage.local.set({ [TODOS_KEY]: map });
  notify('user_todos', conversationId);
  return removed;
}

// ─── aggregate view (powers ListsHubView) ───────────────────────────────────

export async function getAllConversationLists(): Promise<ConversationListsSummary[]> {
  const [plans, taskResult, todos] = await Promise.all([
    readPlans(),
    chatDb().from('agent_task').select(AGENT_TASK_COLUMNS).order('position', { ascending: true }),
    readTodos(),
  ]);
  if (taskResult.error) {
    throw new Error(`Failed to load agent task summaries: ${taskResult.error.message}`);
  }
  const tasks: Record<string, Task[]> = {};
  for (const task of taskRows(taskResult.data)) {
    const conversationTasks = tasks[task.conversation_id] ?? [];
    conversationTasks.push(task);
    tasks[task.conversation_id] = conversationTasks;
  }
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
    // Legacy empty arrays (pre-cleanup installs) would render as ghost
    // epoch-dated rows.
    if (!plan && t.length === 0 && u.length === 0) continue;
    const lastActivity = Math.max(
      plan?.updated_at ?? 0,
      ...t.map((x) => x.updated_at),
      ...u.map((x) => x.done_at ?? x.created_at),
      0,
    );
    out.push({
      conversation_id: id,
      has_plan: !!plan,
      ...(plan?.title !== undefined && { plan_title: plan.title }),
      ...(plan?.status !== undefined && { plan_status: plan.status }),
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
  const [plans, todos, taskResult] = await Promise.all([
    readPlans(),
    readTodos(),
    chatDb().from('agent_task').delete().eq('conversation_id', conversationId).select('id'),
  ]);
  if (taskResult.error) {
    throw new Error(`Failed to purge agent tasks: ${taskResult.error.message}`);
  }
  let changed = false;
  if (plans[conversationId]) {
    delete plans[conversationId];
    changed = true;
  }
  if ((taskResult.data ?? []).length > 0) changed = true;
  if (todos[conversationId]) {
    delete todos[conversationId];
    changed = true;
  }
  if (!changed) return;
  await chrome.storage.local.set({
    [PLAN_KEY]: plans,
    [TODOS_KEY]: todos,
  });
  notify('plan', conversationId);
  notify('tasks', conversationId);
  notify('user_todos', conversationId);
}
