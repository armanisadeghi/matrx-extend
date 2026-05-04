/**
 * Sidepanel-side listener for SW AGENDA_RUN_NOW broadcasts.
 *
 * Mounted ONCE at App level so it works regardless of which tab the user
 * is currently viewing. When the SW alarm fires for an auto-mode task,
 * we claim the run + execute the prompt via the chat-stream pipeline.
 *
 * For ask-mode tasks the SW skips the broadcast and goes straight to
 * notification — the user clicks, lands on the Agenda tab, and presses
 * Run-now manually.
 */

import { useChatStream } from '@/hooks/use-chat-stream';
import { getTask } from '@/lib/agenda/queries';
import { isTaskRunning, runTask } from '@/lib/agenda/runner';
import { log } from '@/lib/debug/log';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useEffect } from 'react';

export function useAgendaListener(): void {
  const { send } = useChatStream();

  useEffect(() => {
    const unsubscribe = on<{ taskId: string }, { ack: true }>(
      CHANNELS.AGENDA_RUN_NOW,
      async (payload) => {
        const taskId = payload.taskId;
        if (isTaskRunning(taskId)) return { ack: true };
        const task = await getTask(taskId);
        if (!task) {
          log.warn('sys', `agenda listener: task ${taskId} not found`);
          return { ack: true };
        }
        if (!task.enabled) return { ack: true };
        log.info('sys', `agenda listener: SW asked us to run "${task.title}"`);
        await runTask(task, send);
        return { ack: true };
      },
    );
    return unsubscribe;
  }, [send]);
}
