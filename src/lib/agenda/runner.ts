/**
 * Agenda task runner — sidepanel-side orchestrator for a single execution.
 *
 * Flow:
 *   1. Claim a run row (lease pattern; another surface won't double-fire).
 *   2. Send the task's prompt through the shared chat (`sendThroughPackageChat`): the agent is
 *      task.agent_id ?? settings.defaultAgentId ?? the canonical default-chat Mandate reference,
 *      the conversation is task.persistent_conversation_id (heartbeats) or a new one.
 *   3. Settle the run from the send's own outcome and — if this was the first run of a heartbeat —
 *      capture the new conversation_id so subsequent runs append to the same thread.
 *
 * This module is the only place that ties Agenda to the chat. The SW-side code never imports from
 * here; runner is sidepanel-context only.
 */

import { sendThroughPackageChat } from '@/lib/chat-target';
import { log } from '@/lib/debug/log';
import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';
import { useSettingsStore } from '@/state/settings';
import { AGENDA_SURFACE_ID } from './constants';
import {
  type AgendaRun,
  type AgendaTask,
  claimRun,
  finishRun,
  markRunStarted,
  updateTask,
} from './queries';

interface RunHandle {
  run: AgendaRun;
  task: AgendaTask;
}

const inFlightByTaskId = new Map<string, RunHandle>();

export function isTaskRunning(taskId: string): boolean {
  return inFlightByTaskId.has(taskId);
}

/**
 * Kick off a run. Returns null if another surface already holds the lease
 * or if the lease attempt failed; otherwise returns the new run row.
 */
export async function runTask(task: AgendaTask): Promise<AgendaRun | null> {
  if (inFlightByTaskId.has(task.id)) {
    log.info('sys', `agenda: task ${task.id} already running locally`);
    return null;
  }

  const run = await claimRun(task, AGENDA_SURFACE_ID, {
    lease_seconds: task.max_runtime_seconds,
  });
  if (!run) {
    log.warn('sys', `agenda: failed to claim run for task ${task.id}`);
    return null;
  }
  log.info('sys', `agenda: claimed run ${run.id} for task "${task.title}"`);
  return runThroughPackageChat(task, run);
}

/**
 * The run: one send through the shared chat (an AI send — callers and tests decide
 * when it is allowed to happen). Settles the run from the send's own outcome.
 */
export async function runThroughPackageChat(
  task: AgendaTask,
  run: AgendaRun,
  sendMessage: typeof sendThroughPackageChat = sendThroughPackageChat,
): Promise<AgendaRun | null> {
  const agentRef =
    task.agent_id ?? useSettingsStore.getState().defaultAgentId ?? DEFAULT_CHAT_MANDATE_REF;
  const target = agentRef.startsWith('mandate:')
    ? { mandateKey: agentRef.slice('mandate:'.length) }
    : { agentId: agentRef };
  inFlightByTaskId.set(task.id, { run, task });
  try {
    const { conversationId } = await sendMessage({
      text: task.prompt,
      ...target,
      conversationId: task.persistent_conversation_id,
    });
    await markRunStarted(run.id, conversationId);
    if (task.trigger_type === 'heartbeat' && !task.persistent_conversation_id) {
      await updateTask(task.id, { persistent_conversation_id: conversationId });
    }
    await finishRun(run.id, 'success');
    return run;
  } catch (err) {
    log.error('sys', `agenda: package-chat send failed for run ${run.id}`, err);
    await finishRun(run.id, 'failed', { error_message: (err as Error).message });
    return null;
  } finally {
    inFlightByTaskId.delete(task.id);
  }
}

/** For UI: cancel an in-flight run we know about. */
export async function cancelRun(taskId: string): Promise<void> {
  const handle = inFlightByTaskId.get(taskId);
  if (!handle) return;
  inFlightByTaskId.delete(taskId);
  await finishRun(handle.run.id, 'cancelled');
}
