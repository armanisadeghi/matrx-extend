/**
 * Subscribes the sidepanel to tool-related broadcasts from the SW dispatcher.
 *
 *   TOOL_CONFIRM_REQUEST   → adds to pendingConfirms (tagged with current convo)
 *   TOOL_ASK_USER_REQUEST  → adds to pendingAsks
 *   TOOL_TIMELINE_EVENT    → upserts into the ACTIVE assistant message's parts
 *                           (chat-store), so the tool entry interleaves with
 *                           text/reasoning in the order it arrived.
 *
 * Replies (allow/deny, answers) are sent back via TOOL_CONFIRM_RESPONSE /
 * TOOL_ASK_USER_RESPONSE — see respondToConfirm / respondToAsk below.
 */

import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type {
  AskUserResponse,
  ConfirmResponse,
  PendingAskUserRequest,
  PendingConfirmRequest,
} from '@/lib/tools/types';
import { type ToolPartCall, useChatStore } from '@/state/chat';
import { useToolInbox } from '@/state/tool-inbox';
import type { ToolProgressUpdate } from '@/lib/tools/types';
import { useEffect } from 'react';

interface TimelinePayload {
  callId: string;
  toolName: string;
  phase: 'started' | 'completed' | 'error';
  args?: unknown;
  output?: unknown;
  message?: string;
  /**
   * Set when this event is an incremental progress update from a long-running
   * client tool (via `ctx.reportProgress`). When present, it's appended to the
   * tool part's progress log and `phase` is left unchanged.
   */
  progress?: ToolProgressUpdate;
}

/**
 * Find the most recent assistant message in the current conversation. That's
 * where new tool parts attach — same place text and reasoning chunks land.
 */
function activeAssistantMessageId(): string | null {
  const messages = useChatStore.getState().messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant') return m.id;
  }
  return null;
}

export function useToolInbox$Subscribe(): void {
  useEffect(() => {
    const offConfirm = on<PendingConfirmRequest, { ack: true }>(
      CHANNELS.TOOL_CONFIRM_REQUEST,
      (payload) => {
        // The SW dispatcher injects ctx.conversationId into the payload.
        // Prefer that — it correctly routes Pilot-spawned cards to the
        // Pilot surface and Assistant-spawned cards to the Chat surface.
        // Falling back to the chat store is only for legacy / unknown
        // dispatch paths that didn't set the field.
        const conversationId =
          payload.conversationId ?? useChatStore.getState().selectedConversationId;
        useToolInbox.getState().addConfirm(payload, conversationId);
        return { ack: true };
      },
    );
    const offAsk = on<PendingAskUserRequest, { ack: true }>(
      CHANNELS.TOOL_ASK_USER_REQUEST,
      (payload) => {
        const conversationId =
          payload.conversationId ?? useChatStore.getState().selectedConversationId;
        useToolInbox.getState().addAsk(payload, conversationId);
        return { ack: true };
      },
    );
    // Tool started/completed/error events route into the active assistant
    // message's parts array — that's what gets ordering right (tool entries
    // appear inline at the point they fired) AND conversation isolation
    // (parts ride with the message; switching conversations replaces the
    // message list, so old tool entries vanish).
    const offTimeline = on<TimelinePayload, { ack: true }>(
      CHANNELS.TOOL_TIMELINE_EVENT,
      (payload) => {
        const messageId = activeAssistantMessageId();
        if (!messageId) return { ack: true };
        // Incremental progress update — append to the part's progress log
        // without touching its phase. Routed here (not upsertToolPart) so a
        // progress event never accidentally flips a completed row back to
        // 'started'.
        if (payload.progress) {
          useChatStore.getState().appendToolProgress(
            messageId,
            payload.callId,
            { at: Date.now(), ...payload.progress },
            { toolName: payload.toolName, kind: 'client' },
          );
          return { ack: true };
        }
        // Only set fields that are actually defined on this event. The SW
        // sends `args` only on `started` and `output` only on `completed`,
        // so spreading undefined would wipe the args we captured at start.
        const patch: Partial<ToolPartCall> & { kind: 'client' } = {
          kind: 'client',
          toolName: payload.toolName,
          phase: payload.phase,
        };
        if (payload.args !== undefined) patch.args = payload.args;
        if (payload.output !== undefined) patch.result = payload.output;
        if (payload.message !== undefined) patch.message = payload.message;
        useChatStore.getState().upsertToolPart(messageId, payload.callId, patch);
        return { ack: true };
      },
    );
    return () => {
      offConfirm();
      offAsk();
      offTimeline();
    };
  }, []);
}

export function respondToConfirm(
  callId: string,
  decision: 'allow' | 'deny',
  rememberFor?: 'session' | 'conversation',
): void {
  useToolInbox.getState().removeConfirm(callId);
  const res: ConfirmResponse = { callId, decision, rememberFor };
  broadcast(CHANNELS.TOOL_CONFIRM_RESPONSE, res);
}

/**
 * Send the user's reply back to the SW dispatcher. Accepts a partial
 * envelope — only the fields relevant to the request's `kind` need to
 * be populated (e.g. `confirmed` for confirm, `selected` for choice).
 * The handler in user.ts maps this onto the unified output shape.
 */
export function respondToAsk(callId: string, reply: Omit<AskUserResponse, 'callId'>): void {
  useToolInbox.getState().removeAsk(callId);
  const res: AskUserResponse = { callId, ...reply };
  broadcast(CHANNELS.TOOL_ASK_USER_RESPONSE, res);
}
