/**
 * Lists hub — cross-conversation aggregate of plans, agent tasks, and
 * user todos. Sister to the per-chat TaskPanel drawer; this is the
 * place to triage everything in one go (bulk delete, clear done, jump
 * to a conversation).
 *
 * Reads via getAllConversationLists() on mount, local LISTS_CHANGED
 * broadcasts, and `chat.agent_task` Realtime events so server task writes
 * repaint without polling.
 *
 * REALTIME: both channels are `@ai-matrx/realtime`'s. What was here were two
 * hand-rolled `supabase.channel(...)` blocks with their own `removeChannel`
 * teardown, no reconnect (a dropped channel stayed dropped for the life of the
 * panel), no dedup, and no catch-up read — a task written while the sidepanel
 * slept never arrived and the hub kept showing yesterday's counts. `onBackfill`
 * re-reads on every recovery path. The detail channel also grew the
 * `conversation_id` filter its topic name always implied: it used to wake on
 * EVERY agent_task row in the account to refetch one conversation.
 */

import { ConfirmDialog } from '@ai-matrx/design-system';
import { Badge, Button } from "@ai-matrx/design-system";
import { ScrollArea } from "@ai-matrx/design-system";
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
import {
  agentTaskFingerprint,
  listsAllTasksChannel,
  listsConversationTasksChannel,
} from '@/lib/lists/realtime';
import type { ConversationListsSummary, Task, UserTodo } from '@/lib/lists/types';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/state/chat';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { useChannel } from '@ai-matrx/realtime/react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface ExpandedDetail {
  conversationId: string;
  tasks: Task[];
  user_todos: UserTodo[];
}

export function ListsHubView(): React.JSX.Element {
  const [summaries, setSummaries] = useState<ConversationListsSummary[]>([]);
  const [expanded, setExpanded] = useState<ExpandedDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const expandedConversationId = expanded?.conversationId ?? null;

  const refreshSummaries = useCallback((): void => {
    void getAllConversationLists().then((s) => {
      setSummaries(s);
      setLoading(false);
    });
  }, []);

  const refreshDetail = useCallback((): void => {
    if (!expandedConversationId) return;
    void Promise.all([
      listTasks(expandedConversationId),
      listUserTodos(expandedConversationId),
    ]).then(([tasks, user_todos]) => {
      setExpanded((cur) =>
        cur?.conversationId === expandedConversationId
          ? { conversationId: expandedConversationId, tasks, user_todos }
          : cur,
      );
    });
  }, [expandedConversationId]);

  // Refresh everything on mount + when anything changes anywhere.
  useEffect(() => {
    refreshSummaries();
    const off = on<
      { kind: 'plan' | 'tasks' | 'user_todos'; conversation_id: string },
      { ack: true }
    >(CHANNELS.LISTS_CHANGED, () => {
      refreshSummaries();
      return { ack: true };
    });
    return off;
  }, [refreshSummaries]);

  useChannel({
    topic: listsAllTasksChannel.topic(),
    postgresChanges: [
      {
        event: '*',
        schema: 'chat',
        table: 'agent_task',
        rowId: (row) => (typeof row.id === 'string' ? row.id : undefined),
        fingerprint: agentTaskFingerprint,
        onChange: () => refreshSummaries(),
      },
    ],
    // Realtime has no replay: every task written while this panel was closed or
    // the socket was away is gone. Re-read instead of trusting the screen.
    onBackfill: () => refreshSummaries(),
  });

  // When the expanded conversation's data changes, refresh that detail too.
  useEffect(() => {
    if (!expandedConversationId) return undefined;
    refreshDetail();
    return on<{ conversation_id: string }, { ack: true }>(CHANNELS.LISTS_CHANGED, (payload) => {
      if (payload.conversation_id === expandedConversationId) refreshDetail();
      return { ack: true };
    });
  }, [expandedConversationId, refreshDetail]);

  useChannel(
    expandedConversationId
      ? {
          topic: listsConversationTasksChannel.topic({
            conversationId: expandedConversationId,
          }),
          postgresChanges: [
            {
              event: '*',
              schema: 'chat',
              table: 'agent_task',
              filter: `conversation_id=eq.${expandedConversationId}`,
              rowId: (row) => (typeof row.id === 'string' ? row.id : undefined),
              fingerprint: agentTaskFingerprint,
              onChange: () => refreshDetail(),
            },
          ],
          onBackfill: () => refreshDetail(),
        }
      : null,
  );

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
            onOpenChange={(next) => {
              if (!next) setWipeConfirmOpen(false);
            }}
            title="Wipe this conversation's lists?"
            description="Plan, tasks, and todos for this conversation will be permanently removed."
            confirmLabel="Wipe all"
            variant="destructive"
            onConfirm={() => {
              setWipeConfirmOpen(false);
              void purgeConversation(detail.conversationId);
            }}
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
