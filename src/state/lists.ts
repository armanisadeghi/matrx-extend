/**
 * Sidepanel-side mirror of the plan + tasks + user_todos storage layer.
 *
 * Agent tasks come from shared `chat.agent_task`; plan and user-todo state
 * lives in chrome.storage.local (see src/lib/lists/storage.ts). This store is
 * a thin reactive cache scoped to the conversation the UI is displaying.
 *
 * Mutations go through src/lib/lists/storage.ts (which fires LISTS_CHANGED)
 * — UI components should NEVER write directly to chrome.storage.local.
 */

import {
  getPlan as storageGetPlan,
  listTasks as storageListTasks,
  listUserTodos as storageListUserTodos,
} from '@/lib/lists/storage';
import type { Plan, Task, UserTodo } from '@/lib/lists/types';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { getSupabase } from '@/lib/supabase/client';
import { useEffect } from 'react';
import { create } from 'zustand';

interface ListsState {
  /** Conversation being displayed. Set by ChatView / PilotView on mount. */
  conversationId: string | null;
  plan: Plan | null;
  tasks: Task[];
  user_todos: UserTodo[];
  loading: boolean;

  setConversation: (id: string | null) => void;
  setPlan: (p: Plan | null) => void;
  setTasks: (t: Task[]) => void;
  setUserTodos: (u: UserTodo[]) => void;
  setLoading: (b: boolean) => void;
  /** Hard reset — called when the user clears the conversation or signs out. */
  clear: () => void;
}

export const useListsStore = create<ListsState>((set) => ({
  conversationId: null,
  plan: null,
  tasks: [],
  user_todos: [],
  loading: false,

  setConversation: (id) => set({ conversationId: id, plan: null, tasks: [], user_todos: [] }),
  setPlan: (plan) => set({ plan }),
  setTasks: (tasks) => set({ tasks }),
  setUserTodos: (user_todos) => set({ user_todos }),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ conversationId: null, plan: null, tasks: [], user_todos: [], loading: false }),
}));

async function refreshAll(conversationId: string): Promise<void> {
  const [plan, tasks, todos] = await Promise.all([
    storageGetPlan(conversationId),
    storageListTasks(conversationId),
    storageListUserTodos(conversationId),
  ]);
  // Re-check before applying — the active conversation may have changed
  // while we were awaiting storage.
  const cur = useListsStore.getState().conversationId;
  if (cur !== conversationId) return;
  useListsStore.setState({
    plan,
    tasks,
    user_todos: todos,
    loading: false,
  });
}

/**
 * Mount once at the top of ChatView + PilotView. Subscribes to
 * LISTS_CHANGED broadcasts and refreshes the visible slice whenever the
 * active conversation's data changes from elsewhere (SW tool handler,
 * a parallel sidepanel, another tab editing the same data, etc.).
 */
export function useListsSubscriber(conversationId: string | null, enabled = true): void {
  useEffect(() => {
    // Disabled subscribers (surfaces whose sidepanel tab is hidden) must not
    // claim OR clear the singleton — clearing would clobber the active
    // surface's slice.
    if (!enabled) return;
    useListsStore.getState().setConversation(conversationId);
    if (!conversationId) return;

    useListsStore.getState().setLoading(true);
    void refreshAll(conversationId);

    const off = on<
      { kind: 'plan' | 'tasks' | 'user_todos'; conversation_id: string },
      { ack: true }
    >(CHANNELS.LISTS_CHANGED, (payload) => {
      if (payload.conversation_id !== conversationId) return { ack: true };
      // Re-read just the slice that changed to keep storage I/O minimal.
      if (payload.kind === 'plan') {
        void storageGetPlan(conversationId).then((plan) => {
          if (useListsStore.getState().conversationId === conversationId) {
            useListsStore.setState({ plan });
          }
        });
      } else if (payload.kind === 'tasks') {
        void storageListTasks(conversationId).then((tasks) => {
          if (useListsStore.getState().conversationId === conversationId) {
            useListsStore.setState({ tasks });
          }
        });
      } else {
        void storageListUserTodos(conversationId).then((user_todos) => {
          if (useListsStore.getState().conversationId === conversationId) {
            useListsStore.setState({ user_todos });
          }
        });
      }
      return { ack: true };
    });

    const refreshTasks = (): void => {
      void storageListTasks(conversationId).then((tasks) => {
        if (useListsStore.getState().conversationId === conversationId) {
          useListsStore.setState({ tasks });
        }
      });
    };
    const supabase = getSupabase();
    const taskChannel = supabase
      .channel(`chat-agent-task:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'chat',
          table: 'agent_task',
          filter: `conversation_id=eq.${conversationId}`,
        },
        refreshTasks,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'chat',
          table: 'agent_task',
          filter: `conversation_id=eq.${conversationId}`,
        },
        refreshTasks,
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'chat',
          table: 'agent_task',
        },
        refreshTasks,
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[lists] chat.agent_task Realtime subscription failed');
        }
      });

    return () => {
      off();
      void supabase.removeChannel(taskChannel);
    };
  }, [conversationId, enabled]);
}
