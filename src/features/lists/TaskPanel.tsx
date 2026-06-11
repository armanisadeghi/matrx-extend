/**
 * TaskPanel — drawer that surfaces the current conversation's plan,
 * agent tasks, and user todos.
 *
 * Mounted in both ChatView and PilotView (props pass the conversationId
 * + a controlled open flag). The store subscriber refreshes the slice
 * whenever LISTS_CHANGED fires for this conversation.
 *
 * All edits go through src/lib/lists/storage.ts so the SW handlers and
 * the UI share one mutation path — the resulting LISTS_CHANGED broadcast
 * keeps the model's next-turn context aligned with what the user sees.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  addTasks,
  addUserTodo,
  clearCompletedTasks,
  clearDoneUserTodos,
  removeTask,
  removeUserTodo,
  updateTask,
  updateUserTodo,
} from '@/lib/lists/storage';
import type { Task, TaskStatus, UserTodo } from '@/lib/lists/types';
import { cn } from '@/lib/utils';
import { useListsStore, useListsSubscriber } from '@/state/lists';
import { Check, CircleDashed, CircleSlash, Clock, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

interface Props {
  conversationId: string | null;
  open: boolean;
  onClose: () => void;
  /** Claim the lists store only while this surface's tab is visible. */
  enabled?: boolean;
}

const STATUS_ORDER: TaskStatus[] = ['pending', 'in_progress', 'done', 'blocked', 'skipped'];

const STATUS_META: Record<TaskStatus, { label: string; tone: string; icon: typeof Check }> = {
  pending: {
    label: 'Pending',
    tone: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
    icon: CircleDashed,
  },
  in_progress: {
    label: 'In progress',
    tone: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    icon: Clock,
  },
  done: {
    label: 'Done',
    tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    icon: Check,
  },
  blocked: {
    label: 'Blocked',
    tone: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    icon: CircleSlash,
  },
  skipped: {
    label: 'Skipped',
    tone: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500 line-through',
    icon: CircleSlash,
  },
};

export function TaskPanel({
  conversationId,
  open,
  onClose,
  enabled = true,
}: Props): React.JSX.Element | null {
  useListsSubscriber(conversationId, enabled);
  const plan = useListsStore((s) => s.plan);
  const tasks = useListsStore((s) => s.tasks);
  const userTodos = useListsStore((s) => s.user_todos);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTodoTitle, setNewTodoTitle] = useState('');

  if (!open) return null;

  const cid = conversationId;
  if (!cid) {
    return (
      <div className="fixed inset-y-0 right-0 z-40 w-96 border-l border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <Header onClose={onClose} />
        <p className="mt-8 text-sm text-zinc-500">
          Start a conversation to begin tracking tasks here.
        </p>
      </div>
    );
  }

  const openTodos = userTodos.filter((t) => !t.done);
  const doneTodos = userTodos.filter((t) => t.done);

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-96 flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      <Header onClose={onClose} />
      <ScrollArea className="flex-1 px-4 py-3">
        {/* ── Plan ───────────────────────────────────────────────────── */}
        {plan ? (
          <section className="mb-4">
            <SectionTitle
              label="Plan"
              right={
                <Badge variant="outline" className="text-xs">
                  {plan.status}
                </Badge>
              }
            />
            <p className="mt-1 text-sm font-medium">{plan.title}</p>
            {plan.reasoning ? (
              <p className="mt-1 text-xs italic text-zinc-500">{plan.reasoning}</p>
            ) : null}
            <ol className="mt-2 space-y-1 text-xs">
              {plan.steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-4 text-zinc-400">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* ── Tasks (agent's list) ───────────────────────────────────── */}
        <section className="mb-4">
          <SectionTitle
            label="Tasks"
            right={
              <span className="text-xs text-zinc-500">
                {tasks.filter((t) => t.status === 'done').length} / {tasks.length}
              </span>
            }
          />
          <div className="mt-2 space-y-1">
            {tasks.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No tasks yet. The agent will populate this as work progresses.
              </p>
            ) : (
              tasks.map((t) => <TaskRow key={t.id} task={t} conversationId={cid} />)
            )}
          </div>
          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const title = newTaskTitle.trim();
              if (!title) return;
              void addTasks(cid, [{ title }], 'user');
              setNewTaskTitle('');
            }}
          >
            <Input
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Add a task..."
              className="h-7 text-xs"
            />
            <Button type="submit" size="sm" variant="ghost" className="h-7 px-2">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </form>
          {tasks.some((t) => t.status === 'done' || t.status === 'skipped') ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 h-6 px-2 text-xs text-zinc-500"
              onClick={() => void clearCompletedTasks(cid)}
            >
              Clear completed
            </Button>
          ) : null}
        </section>

        {/* ── User todos ─────────────────────────────────────────────── */}
        <section className="mb-4">
          <SectionTitle
            label="Your todos"
            right={<span className="text-xs text-zinc-500">{openTodos.length} open</span>}
          />
          <div className="mt-2 space-y-1">
            {userTodos.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No items from the agent. When it asks you to do something, it shows up here.
              </p>
            ) : (
              <>
                {openTodos.map((t) => (
                  <UserTodoRow key={t.id} todo={t} conversationId={cid} />
                ))}
                {doneTodos.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-zinc-500">
                      {doneTodos.length} done
                    </summary>
                    <div className="mt-1 space-y-1">
                      {doneTodos.map((t) => (
                        <UserTodoRow key={t.id} todo={t} conversationId={cid} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </>
            )}
          </div>
          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const title = newTodoTitle.trim();
              if (!title) return;
              void addUserTodo(cid, { title });
              setNewTodoTitle('');
            }}
          >
            <Input
              value={newTodoTitle}
              onChange={(e) => setNewTodoTitle(e.target.value)}
              placeholder="Note something for yourself..."
              className="h-7 text-xs"
            />
            <Button type="submit" size="sm" variant="ghost" className="h-7 px-2">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </form>
          {doneTodos.length ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 h-6 px-2 text-xs text-zinc-500"
              onClick={() => void clearDoneUserTodos(cid)}
            >
              Clear done
            </Button>
          ) : null}
        </section>
      </ScrollArea>
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">Plan & tasks</h2>
      <Button type="button" variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function SectionTitle({
  label,
  right,
}: { label: string; right?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-zinc-200 pb-1 dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</h3>
      {right}
    </div>
  );
}

function TaskRow({
  task,
  conversationId,
}: { task: Task; conversationId: string }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const meta = STATUS_META[task.status];
  const Icon = meta.icon;

  return (
    <div className="group flex items-start gap-1 rounded-sm px-1 py-0.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900">
      <button
        type="button"
        className="mt-0.5"
        onClick={() => {
          const idx = STATUS_ORDER.indexOf(task.status);
          const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length]!;
          void updateTask(conversationId, task.id, { status: next });
        }}
        title={`${meta.label} — click to cycle`}
      >
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            task.status === 'done' ? 'text-emerald-600' : 'text-zinc-400',
          )}
        />
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const t = draft.trim();
              if (t && t !== task.title) void updateTask(conversationId, task.id, { title: t });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDraft(task.title);
                setEditing(false);
              }
            }}
            className="h-6 text-xs"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              // Seed from the CURRENT title — the once-per-mount useState
              // meant an agent rename showed (and blur wrote back) the
              // stale title, silently undoing the agent's update.
              setDraft(task.title);
              setEditing(true);
            }}
            className={cn(
              'block w-full text-left',
              task.status === 'done' || task.status === 'skipped'
                ? 'text-zinc-400 line-through'
                : '',
            )}
          >
            {task.title}
          </button>
        )}
        {task.note ? <p className="mt-0.5 text-[10px] italic text-zinc-500">{task.note}</p> : null}
      </div>
      <button
        type="button"
        className="opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => void removeTask(conversationId, task.id)}
        title="Remove"
      >
        <Trash2 className="h-3 w-3 text-zinc-400" />
      </button>
    </div>
  );
}

function UserTodoRow({
  todo,
  conversationId,
}: {
  todo: UserTodo;
  conversationId: string;
}): React.JSX.Element {
  return (
    <div className="group flex items-start gap-1 rounded-sm px-1 py-0.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900">
      <input
        type="checkbox"
        className="mt-1"
        checked={todo.done}
        onChange={(e) => void updateUserTodo(conversationId, todo.id, { done: e.target.checked })}
      />
      <div className="min-w-0 flex-1">
        <p className={cn(todo.done ? 'text-zinc-400 line-through' : '')}>{todo.title}</p>
        {todo.context ? <p className="text-[10px] italic text-zinc-500">{todo.context}</p> : null}
        {todo.due ? <p className="text-[10px] text-amber-600">Due: {todo.due}</p> : null}
      </div>
      <button
        type="button"
        className="opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => void removeUserTodo(conversationId, todo.id)}
        title="Remove"
      >
        <Trash2 className="h-3 w-3 text-zinc-400" />
      </button>
    </div>
  );
}

/** Small badge for the chat header — shows tasks summary + open todos. */
export function TaskPanelChip({
  conversationId,
  onClick,
  enabled = true,
}: {
  conversationId: string | null;
  onClick: () => void;
  /** Claim the lists store only while this surface's tab is visible. */
  enabled?: boolean;
}): React.JSX.Element | null {
  useListsSubscriber(conversationId, enabled);
  const plan = useListsStore((s) => s.plan);
  const tasks = useListsStore((s) => s.tasks);
  const userTodos = useListsStore((s) => s.user_todos);
  if (!conversationId) return null;
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const openTodos = userTodos.filter((t) => !t.done).length;
  const hasContent = !!plan || total > 0 || openTodos > 0;
  if (!hasContent) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-6 gap-1.5 px-2 text-xs"
      title="Show plan / tasks / todos"
    >
      {total > 0 ? (
        <span>
          📋 {done}/{total}
        </span>
      ) : null}
      {openTodos > 0 ? <span className="text-amber-600">📌 {openTodos}</span> : null}
    </Button>
  );
}
