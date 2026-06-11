/**
 * Lists hub — cross-conversation aggregate of plans, agent tasks, and
 * user todos. Sister to the per-chat TaskPanel drawer; this is the
 * place to triage everything in one go (bulk delete, clear done, jump
 * to a conversation).
 *
 * Reads via getAllConversationLists() on mount + on every LISTS_CHANGED
 * broadcast so the view stays live.
 */

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  clearCompletedTasks,
  clearDoneUserTodos,
  getAllConversationLists,
  listTasks,
  listUserTodos,
  purgeConversation,
  removeTask,
  removeUserTodo,
  updateUserTodo,
} from '@/lib/lists/storage';
import type { ConversationListsSummary, Task, UserTodo } from '@/lib/lists/types';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/state/chat';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ExpandedDetail {
  conversationId: string;
  tasks: Task[];
  user_todos: UserTodo[];
}

export function ListsHubView(): React.JSX.Element {
  const [summaries, setSummaries] = useState<ConversationListsSummary[]>([]);
  const [expanded, setExpanded] = useState<ExpandedDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Refresh everything on mount + when anything changes anywhere.
  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      const s = await getAllConversationLists();
      if (!cancelled) {
        setSummaries(s);
        setLoading(false);
      }
    };
    void refresh();

    const off = on<
      { kind: 'plan' | 'tasks' | 'user_todos'; conversation_id: string },
      { ack: true }
    >(CHANNELS.LISTS_CHANGED, () => {
      void refresh();
      return { ack: true };
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // When the expanded conversation's data changes, refresh that detail too.
  useEffect(() => {
    if (!expanded) return;
    const refresh = async (): Promise<void> => {
      const [tasks, user_todos] = await Promise.all([
        listTasks(expanded.conversationId),
        listUserTodos(expanded.conversationId),
      ]);
      setExpanded({ conversationId: expanded.conversationId, tasks, user_todos });
    };
    void refresh();
    const off = on<{ conversation_id: string }, { ack: true }>(
      CHANNELS.LISTS_CHANGED,
      (payload) => {
        if (payload.conversation_id === expanded.conversationId) void refresh();
        return { ack: true };
      },
    );
    return () => off();
  }, [expanded?.conversationId]);

  if (loading) {
    return <div className="p-4 text-sm text-zinc-500">Loading…</div>;
  }

  if (summaries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-zinc-500">
        <p>No active plans, tasks, or todos yet.</p>
        <p className="mt-1 text-xs">Items show up here as your agents create them.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h1 className="text-sm font-semibold">Plan & tasks across conversations</h1>
        <p className="text-xs text-zinc-500">
          {summaries.length} conversation{summaries.length === 1 ? '' : 's'} with active items.
        </p>
      </header>
      <ScrollArea className="flex-1">
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {summaries.map((s) => (
            <SummaryRow
              key={s.conversation_id}
              summary={s}
              expanded={expanded?.conversationId === s.conversation_id}
              detail={expanded?.conversationId === s.conversation_id ? expanded : null}
              onToggle={() =>
                setExpanded((cur) =>
                  cur?.conversationId === s.conversation_id
                    ? null
                    : { conversationId: s.conversation_id, tasks: [], user_todos: [] },
                )
              }
            />
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

function SummaryRow({
  summary,
  expanded,
  detail,
  onToggle,
}: {
  summary: ConversationListsSummary;
  expanded: boolean;
  detail: ExpandedDetail | null;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <li className="px-4 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {summary.plan_title ?? `Conversation ${summary.conversation_id.slice(0, 8)}`}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
            {summary.has_plan ? (
              <Badge variant="outline" className="text-[10px]">
                {summary.plan_status}
              </Badge>
            ) : null}
            {summary.tasks_total > 0 ? (
              <span>
                📋 {summary.tasks_done}/{summary.tasks_total}
              </span>
            ) : null}
            {summary.user_todos_open > 0 ? (
              <span className="text-amber-600">📌 {summary.user_todos_open}</span>
            ) : null}
            <span className="ml-auto text-[10px]">
              {new Date(summary.last_activity).toLocaleString()}
            </span>
          </div>
        </div>
        <ChevronRight
          className={cn('ml-2 h-4 w-4 transition-transform', expanded ? 'rotate-90' : '')}
        />
      </button>
      {expanded && detail ? <ExpandedView detail={detail} summary={summary} /> : null}
    </li>
  );
}

function ExpandedView({
  detail,
  summary,
}: {
  detail: ExpandedDetail;
  summary: ConversationListsSummary;
}): React.JSX.Element {
  // window.confirm can be suppressed in extension side panels — "Wipe all"
  // would then be a silent no-op. Use the shared dialog like everywhere else.
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  return (
    <div className="mt-2 space-y-3 rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              useChatStore.getState().setConversation(detail.conversationId);
              useSidepanelTabStore.getState().setTab('chat');
            }}
          >
            Open in chat
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-rose-600"
            onClick={() => setWipeConfirmOpen(true)}
          >
            Wipe all
          </Button>
          <ConfirmDialog
            open={wipeConfirmOpen}
            title="Wipe this conversation's lists?"
            description="Plan, tasks, and todos for this conversation will be permanently removed."
            confirmLabel="Wipe all"
            destructive
            onConfirm={() => {
              setWipeConfirmOpen(false);
              void purgeConversation(detail.conversationId);
            }}
            onClose={() => setWipeConfirmOpen(false)}
          />
        </div>
        <p className="text-[10px] text-zinc-500">{summary.conversation_id.slice(0, 12)}…</p>
      </div>

      {detail.tasks.length ? (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Tasks
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-[10px] text-zinc-500"
              onClick={() => void clearCompletedTasks(detail.conversationId)}
            >
              Clear done
            </Button>
          </div>
          <ul className="space-y-0.5">
            {detail.tasks.map((t) => (
              <li
                key={t.id}
                className={cn(
                  'group flex items-center gap-1',
                  t.status === 'done' || t.status === 'skipped' ? 'text-zinc-400 line-through' : '',
                )}
              >
                <span className="text-[10px] uppercase text-zinc-500">{t.status[0]}</span>
                <span className="flex-1 truncate">{t.title}</span>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => void removeTask(detail.conversationId, t.id)}
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3 text-zinc-400" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail.user_todos.length ? (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Your todos
            </h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-[10px] text-zinc-500"
              onClick={() => void clearDoneUserTodos(detail.conversationId)}
            >
              Clear done
            </Button>
          </div>
          <ul className="space-y-0.5">
            {detail.user_todos.map((t) => (
              <li key={t.id} className="group flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={(e) =>
                    void updateUserTodo(detail.conversationId, t.id, { done: e.target.checked })
                  }
                />
                <span className={cn('flex-1 truncate', t.done ? 'text-zinc-400 line-through' : '')}>
                  {t.title}
                </span>
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => void removeUserTodo(detail.conversationId, t.id)}
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3 text-zinc-400" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
