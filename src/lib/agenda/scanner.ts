/**
 * Agenda scanner — runs in the SW on a `chrome.alarms` cadence (every minute).
 *
 * Responsibilities:
 *   1. Find tasks whose `next_due_at <= now` and whose `surfaces` includes
 *      'chrome-extension-chat' or 'any'.
 *   2. For each due task, fire a Chrome notification ('ask' mode) — the
 *      user clicks the notification to run via the sidepanel.
 *      'auto' mode is reserved; v0 doesn't auto-execute.
 *   3. Advance the task's `next_due_at` for recurring triggers, so we don't
 *      re-fire on the next scan.
 *
 * Why notification-driven for v0: programmatic agent invocation from the SW
 * touches the chat-stream pipeline and per-conversation state in non-trivial
 * ways. Shipping the loop notification-first lets users feel the timing
 * immediately and validates UX before we wire auto-execution.
 */

import { ALARMS } from '@/config/env';
import { log } from '@/lib/debug/log';
import { send as msgSend } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  type AgendaTask,
  type TriggerConfig,
  computeNextDueAfterRun,
  listDueForSurface,
  updateTask,
} from './queries';

const NOTIFICATION_PREFIX = 'matrx-agenda:';
const SCAN_PERIOD_MIN = 1;

export function startAgendaScanner(): void {
  chrome.alarms.create(ALARMS.AGENDA_SCAN, { periodInMinutes: SCAN_PERIOD_MIN });
  // First scan immediately on SW boot too — the alarm period doesn't fire
  // until ~1 min after creation.
  void scanAndNotify();
}

export async function scanAndNotify(): Promise<void> {
  let due: AgendaTask[] = [];
  try {
    due = await listDueForSurface('chrome-extension-chat', { limit: 10 });
  } catch (err) {
    log.warn('sw', 'agenda scan query failed', err);
    return;
  }
  if (due.length === 0) return;
  log.info('sw', `agenda: ${due.length} task(s) due`);

  for (const task of due) {
    await fireDueTask(task);
  }
}

async function fireDueTask(task: AgendaTask): Promise<void> {
  // Auto mode: try the live sidepanel first. If it acks, the run starts
  // there immediately (no notification, no click). If nothing acks within
  // a short window, fall back to a notification so the user still sees
  // the task became due.
  let routedToSidepanel = false;
  if (task.auth_mode === 'auto') {
    routedToSidepanel = await tryBroadcastRunNow(task.id);
    if (!routedToSidepanel) await notifyDue(task);
  } else {
    await notifyDue(task);
  }

  // Advance next_due_at so we don't re-fire on the next scan. For one-shot
  // and context-match this nulls out (one-shot disables; context-match
  // re-fires on a different signal).
  const triggerConfig: TriggerConfig = {
    type: task.trigger_type,
    ...task.trigger_config,
  } as TriggerConfig;
  const next = computeNextDueAfterRun(task.trigger_type, triggerConfig);
  await updateTask(task.id, {
    next_due_at: next ?? null,
    last_run_at: new Date().toISOString(),
    // One-shot tasks auto-disable after firing.
    enabled: task.trigger_type === 'one-shot' ? false : task.enabled,
  });
}

/**
 * Returns true if the sidepanel was open and ack'd the broadcast. Uses
 * the request/response `send` so chrome.runtime.sendMessage rejects when
 * no listener is registered (sidepanel closed) — that's our fallback
 * signal to drop a notification instead.
 */
async function tryBroadcastRunNow(taskId: string): Promise<boolean> {
  try {
    const r = await msgSend<{ taskId: string }, { ack: true } | undefined>(
      CHANNELS.AGENDA_RUN_NOW,
      { taskId },
    );
    return !!r && (r as { ack?: boolean }).ack === true;
  } catch {
    return false;
  }
}

async function notifyDue(task: AgendaTask): Promise<void> {
  const id = `${NOTIFICATION_PREFIX}${task.id}`;
  try {
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon-128.png'),
      title: `Agenda: ${task.title}`,
      message: task.description ?? 'Task is due. Click to open the Agenda tab.',
      priority: 1,
      requireInteraction: false,
    });
  } catch (err) {
    log.warn('sw', `agenda notify failed for ${task.id}`, err);
  }
}

/**
 * Wired from SW bootstrap. On notification click → open the sidepanel and
 * focus the Agenda tab. The sidepanel reads the focused-task id from
 * chrome.storage.session and scrolls/highlights it.
 */
export function registerAgendaNotificationClicks(): void {
  if (!chrome.notifications) return;
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    const taskId = notificationId.slice(NOTIFICATION_PREFIX.length);
    try {
      // Surface a hint for the sidepanel to focus this task.
      await chrome.storage.session?.set({ 'matrx.agenda.focus_task_id': taskId });
    } catch {
      /* storage.session can be absent on older Chrome; ignore */
    }
    // Open the sidepanel — chrome.sidePanel.open requires a windowId in MV3.
    try {
      const win = await chrome.windows.getCurrent();
      if (win.id != null && chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ windowId: win.id });
      }
    } catch (err) {
      log.warn('sw', 'sidePanel.open failed on notification click', err);
    }
    chrome.notifications.clear(notificationId);
  });
}
