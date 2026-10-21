/**
 * Every approval card and question the service worker is waiting on, held while it waits.
 *
 * A card is broadcast once; a side panel that was closed at that moment never saw it. So the
 * worker keeps each live prompt here until it is answered, expires or is cancelled, and:
 *  - answers TOOL_INBOX_PENDING, so a side panel that opens later shows the card again;
 *  - shows the count on the extension's toolbar button while anything waits;
 *  - for a caller that is not the person's own chat (Matrx 2, Matrx Local, a web page, the web
 *    app), raises a system notification saying the browser is waiting for their answer.
 * Clicking that notification opens the side panel when Chrome allows it.
 */

import { log } from '@/lib/debug/log';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { PendingAskUserRequest, PendingConfirmRequest } from '@/lib/tools/types';

const confirms = new Map<string, PendingConfirmRequest>();
const asks = new Map<string, PendingAskUserRequest>();
const NOTIFICATION_PREFIX = 'matrx-waiting:';
/** Calls an outside caller (handleWebmcpCall) is running now → who asked. A tool's own questions inherit it. */
const external = new Map<string, string>();

/** handleWebmcpCall marks the call it runs, so a question the tool asks names the real caller. */
export function markExternalCall(callId: string, initiator: string): () => void {
  external.set(callId, initiator);
  return () => {
    external.delete(callId);
  };
}

function initiatorOf(callId: string): string | undefined {
  for (const [id, who] of external) if (callId === id || callId.startsWith(`${id}.`)) return who;
  return undefined;
}

const CALLER_NAMES: Record<string, string> = {
  desktop: 'The Matrx desktop app',
  page: 'A web page',
  frontend: 'AI Matrx on the web',
};

let installed = false;
/** Serve the side panel's "what is waiting?" question. Idempotent; called by the trackers. */
export function installLivePrompts(): void {
  if (installed) return;
  installed = true;
  on<Record<string, never>, { confirms: PendingConfirmRequest[]; asks: PendingAskUserRequest[] }>(
    CHANNELS.TOOL_INBOX_PENDING,
    () => ({ confirms: [...confirms.values()], asks: [...asks.values()] }),
  );
  try {
    chrome.notifications?.onClicked?.addListener((id) => {
      if (!id.startsWith(NOTIFICATION_PREFIX)) return;
      void openSidePanel();
      chrome.notifications.clear(id);
    });
  } catch {
    /* no notifications API in this context */
  }
}

async function openSidePanel(): Promise<void> {
  try {
    const win = await chrome.windows.getLastFocused();
    if (win?.id != null) await chrome.sidePanel.open({ windowId: win.id });
  } catch (err) {
    log.warn('sw', 'could not open the side panel from the waiting notification', String(err));
  }
}

function refreshBadge(): void {
  const n = confirms.size + asks.size;
  try {
    void chrome.action?.setBadgeText({ text: n > 0 ? String(n) : '' });
    if (n > 0) void chrome.action?.setBadgeBackgroundColor({ color: '#d97706' });
  } catch {
    /* no action API in this context */
  }
}

function notifyWaiting(callId: string, initiator: string | undefined, what: string): void {
  const caller = initiator ? CALLER_NAMES[initiator] : undefined;
  if (!caller) return; // the person's own chat: its card shows where they are typing
  try {
    chrome.notifications?.create(`${NOTIFICATION_PREFIX}${callId}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: 'Waiting for your answer in Chrome',
      message: `${caller} asked to ${what}. Open AI Matrx in Chrome to allow or deny it.`,
      requireInteraction: true,
    });
  } catch (err) {
    log.warn('sw', 'waiting notification failed', String(err));
  }
}

function clearNotification(callId: string): void {
  try {
    chrome.notifications?.clear(`${NOTIFICATION_PREFIX}${callId}`);
  } catch {
    /* ignore */
  }
}

export function trackConfirm(req: PendingConfirmRequest): () => void {
  installLivePrompts();
  confirms.set(req.callId, req);
  refreshBadge();
  notifyWaiting(req.callId, req.initiator, `use ${req.toolName}`);
  return () => {
    if (!confirms.delete(req.callId)) return;
    clearNotification(req.callId);
    refreshBadge();
  };
}

export function trackAsk(req: PendingAskUserRequest): () => void {
  installLivePrompts();
  asks.set(req.callId, req);
  refreshBadge();
  notifyWaiting(req.callId, initiatorOf(req.callId), 'ask you something');
  return () => {
    if (!asks.delete(req.callId)) return;
    clearNotification(req.callId);
    refreshBadge();
  };
}

/** Test seam. */
export function __livePromptsForTests(): { confirms: string[]; asks: string[] } {
  return { confirms: [...confirms.keys()], asks: [...asks.keys()] };
}
