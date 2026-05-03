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
import { useChatStore } from '@/state/chat';
import { useToolInbox } from '@/state/tool-inbox';
import { useEffect } from 'react';

interface TimelinePayload {
  callId: string;
  toolName: string;
  phase: 'started' | 'completed' | 'error';
  args?: unknown;
  output?: unknown;
  message?: string;
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
        const conversationId = useChatStore.getState().selectedConversationId;
        useToolInbox.getState().addConfirm(payload, conversationId);
        return { ack: true };
      },
    );
    const offAsk = on<PendingAskUserRequest, { ack: true }>(
      CHANNELS.TOOL_ASK_USER_REQUEST,
      (payload) => {
        const conversationId = useChatStore.getState().selectedConversationId;
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
        useChatStore.getState().upsertToolPart(messageId, payload.callId, {
          kind: 'client',
          toolName: payload.toolName,
          phase: payload.phase,
          args: payload.args,
          result: payload.output,
          message: payload.message,
        });
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

export function respondToAsk(callId: string, answer: string | null, cancelled = false): void {
  useToolInbox.getState().removeAsk(callId);
  const res: AskUserResponse = { callId, answer, cancelled };
  broadcast(CHANNELS.TOOL_ASK_USER_RESPONSE, res);
}
