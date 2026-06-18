/**
 * Cold-resume — re-surface a paused conversation's outstanding client-delegated
 * tool calls when it's reopened.
 *
 * When the user closes the sidepanel/extension while the agent is waiting on a
 * delegated tool (a browser action awaiting confirmation, etc.), the server
 * leaves the conversation `paused` with the call persisted in `cx_tool_call`
 * (status='delegated'). On reopen — minutes, hours, or weeks later — this fetches
 * those calls (`GET /ai/conversations/{id}/pending_calls`, the same canonical
 * discovery contract matrx-frontend uses) and asks the SW to re-dispatch each
 * one. The SW runs it through the SAME handleCall path as a live tool_delegated
 * event: the approval card re-appears, the handler runs, the result is POSTed,
 * and the continuation handshake resumes the agent. See docs/COLD_RESUME.md.
 *
 * Fire-and-forget from the caller's POV; the SW dedupes repeat dispatches per
 * (runId, callId) so a remount can't double-run a handler.
 */

import { getPendingCalls } from '@/lib/api/routes/tool-results';
import { resolveActiveTab } from '@/lib/chat/active-tab';
import { log } from '@/lib/debug/log';
import { send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useChatStore } from '@/state/chat';

/** Returns the number of pending calls re-dispatched (0 when there are none). */
export async function triggerColdResume(conversationId: string): Promise<number> {
  if (!conversationId) return 0;

  const r = await getPendingCalls(conversationId);
  if (!r.ok || !r.data || r.data.length === 0) return 0;

  // Resolve the run context the SW would have latched at STREAM_START. The
  // original tab is long gone on a cold-resume, so the current active tab is the
  // only sensible target; the permission mode is read live from the store.
  const activeTab = await resolveActiveTab();
  const assignedTabId = activeTab?.id ?? null;
  const permissionMode = useChatStore.getState().getPermissionMode(null);

  // `send` (awaited, like STREAM_START) wakes the SW and surfaces a delivery
  // failure, rather than a fire-and-forget broadcast that could be dropped if
  // the SW is momentarily unavailable. Per-call try/catch so one failed
  // hand-off can't abort the rest; the SW handler returns its ack immediately
  // (it does NOT await handleCall), so this resolves fast.
  let dispatched = 0;
  for (const call of r.data) {
    try {
      await send(CHANNELS.COLD_RESUME_CALL, {
        conversationId,
        userRequestId: call.user_request_id,
        callId: call.call_id,
        toolName: call.tool_name,
        args: call.arguments ?? {},
        permissionMode,
        assignedTabId,
      });
      dispatched++;
    } catch (err) {
      log.warn('msg', `cold-resume hand-off failed for ${call.call_id}`, err);
    }
  }

  log.info(
    'msg',
    `cold-resume: re-dispatched ${dispatched}/${r.data.length} pending call(s) for ${conversationId}`,
  );
  return dispatched;
}
