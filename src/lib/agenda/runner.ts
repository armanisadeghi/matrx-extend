/**
 * Agenda task runner — sidepanel-side orchestrator for a single execution.
 *
 * Flow:
 *   1. Claim a run row (lease pattern; another surface won't double-fire).
 *   2. Switch the sidepanel to the chat tab so the user can see it.
 *   3. Set the chat's selected agent + selected conversation:
 *        - agent_id: task.agent_id ?? DEFAULT_AGENDA_AGENT_ID
 *        - conversation_id: task.persistent_conversation_id (heartbeats)
 *                           or null (ephemeral runs)
 *   4. Send the task's prompt as a normal chat message — the existing
 *      use-chat-stream pipeline handles streaming, tool calls, the works.
 *   5. After the stream finishes (chunk.type === 'done'), mark the run as
 *      success and — if this was the first run of a heartbeat — capture
 *      the new conversation_id so subsequent runs append to the same thread.
 *
 * This module is the only place that ties Agenda to the chat stack. The
 * SW-side code never imports from here; runner is sidepanel-context only.
 */

import { log } from '@/lib/debug/log';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useChatStore } from '@/state/chat';
import { useSettingsStore } from '@/state/settings';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import { AGENDA_SURFACE_ID, DEFAULT_AGENDA_AGENT_ID } from './constants';
import {
  type AgendaRun,
  type AgendaTask,
  claimRun,
  finishRun,
  markRunStarted,
  updateTask,
} from './queries';

type SendFn = (
  text: string,
  opts: {
    agentId?: string;
    agentName?: string;
    conversationId?: string;
    variables?: Record<string, unknown>;
  },
) => Promise<string | null>;

interface RunHandle {
  run: AgendaRun;
  task: AgendaTask;
  unsubscribe: () => void;
}

const inFlightByTaskId = new Map<string, RunHandle>();

export function isTaskRunning(taskId: string): boolean {
  return inFlightByTaskId.has(taskId);
}

/**
 * Kick off a run. Returns null if another surface already holds the lease
 * or if the lease attempt failed; otherwise returns the new run row.
 */
export async function runTask(task: AgendaTask, send: SendFn): Promise<AgendaRun | null> {
  if (inFlightByTaskId.has(task.id)) {
    log.info('sys', `agenda: task ${task.id} already running locally`);
    return null;
  }

  const run = await claimRun(task.id, AGENDA_SURFACE_ID, {
    lease_seconds: task.max_runtime_seconds,
  });
  if (!run) {
    log.warn('sys', `agenda: failed to claim run for task ${task.id}`);
    return null;
  }
  log.info('sys', `agenda: claimed run ${run.id} for task "${task.title}"`);

  // Tab-switch + chat-store priming so the user sees the run in the chat tab.
  useSidepanelTabStore.getState().setTab('chat');
  const chat = useChatStore.getState();
  // Honor the task's explicit pick, then fall back to the user's Default
  // Agent preference, then the hardcoded constant as last resort. Same
  // resolution order as the chat surface.
  const agentId =
    task.agent_id ??
    useSettingsStore.getState().defaultAgentId ??
    DEFAULT_AGENDA_AGENT_ID;
  chat.setAgent(agentId);
  if (task.persistent_conversation_id) {
    chat.setConversation(task.persistent_conversation_id);
    // Note: if the chat already had a different conversation loaded, the
    // user will see the heartbeat conversation now. ChatView's useEffect
    // will load messages on next render.
  } else {
    chat.setConversation(null);
    chat.setMessages([]);
  }

  // Fire the send first so we have a real runId to filter listeners on.
  // Without that filter, ANY chat completion would prematurely finish our
  // run row.
  let streamRunId: string | null;
  try {
    streamRunId = await send(task.prompt, {
      agentId,
      conversationId: task.persistent_conversation_id ?? undefined,
    });
  } catch (err) {
    log.error('sys', `agenda: send threw for run ${run.id}`, err);
    inFlightByTaskId.delete(task.id);
    await finishRun(run.id, 'failed', { error_message: (err as Error).message });
    return null;
  }
  if (!streamRunId) {
    inFlightByTaskId.delete(task.id);
    await finishRun(run.id, 'failed', { error_message: 'send returned null runId' });
    return null;
  }

  // Subscribe to stream events, filtered by THIS run's id. Without that
  // filter we'd accidentally claim a manual chat completion as ours.
  let conversationId: string | null = task.persistent_conversation_id;
  let started = false;
  const unsubOpened = on<
    { runId: string; conversationId: string | null; requestId: string | null },
    { ack: true }
  >(CHANNELS.STREAM_OPENED, async (payload) => {
    if (payload.runId !== streamRunId || started) return { ack: true };
    started = true;
    conversationId = payload.conversationId ?? conversationId;
    await markRunStarted(run.id, conversationId ?? undefined);
    if (
      task.trigger_type === 'heartbeat' &&
      !task.persistent_conversation_id &&
      conversationId
    ) {
      await updateTask(task.id, { persistent_conversation_id: conversationId });
      log.info('sys', `agenda: heartbeat ${task.id} persists in convo ${conversationId}`);
    }
    return { ack: true };
  });
  const unsubChunk = on<
    { runId: string; type: string; payload: { message?: string } },
    { ack: true }
  >(CHANNELS.STREAM_CHUNK, async (payload) => {
    if (payload.runId !== streamRunId) return { ack: true };
    if (payload.type === 'done') {
      await handle.unsubscribe();
      inFlightByTaskId.delete(task.id);
      await finishRun(run.id, 'success');
      log.info('sys', `agenda: run ${run.id} succeeded`);
    } else if (payload.type === 'error') {
      await handle.unsubscribe();
      inFlightByTaskId.delete(task.id);
      await finishRun(run.id, 'failed', { error_message: payload.payload?.message });
      log.warn('sys', `agenda: run ${run.id} failed — ${payload.payload?.message}`);
    }
    return { ack: true };
  });

  const handle: RunHandle = {
    run,
    task,
    unsubscribe: async () => {
      try {
        unsubOpened();
      } catch {}
      try {
        unsubChunk();
      } catch {}
    },
  };
  inFlightByTaskId.set(task.id, handle);

  return run;
}

/** For UI: cancel an in-flight run we know about. */
export async function cancelRun(taskId: string): Promise<void> {
  const handle = inFlightByTaskId.get(taskId);
  if (!handle) return;
  await handle.unsubscribe();
  inFlightByTaskId.delete(taskId);
  await finishRun(handle.run.id, 'cancelled');
}
