/**
 * Subscribes the sidepanel to tool-related broadcasts from the SW dispatcher.
 *   TOOL_CONFIRM_REQUEST → adds to pendingConfirms
 *   TOOL_ASK_USER_REQUEST → adds to pendingAsks
 *   TOOL_TIMELINE_EVENT → upserts into timeline
 *
 * Replies (allow/deny, answers) are sent back via TOOL_CONFIRM_RESPONSE /
 * TOOL_ASK_USER_RESPONSE — see useToolInboxActions.
 */

import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type {
  AskUserResponse,
  ConfirmResponse,
  PendingAskUserRequest,
  PendingConfirmRequest,
} from '@/lib/tools/types';
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

export function useToolInbox$Subscribe(): void {
  useEffect(() => {
    const offConfirm = on<PendingConfirmRequest, { ack: true }>(
      CHANNELS.TOOL_CONFIRM_REQUEST,
      (payload) => {
        useToolInbox.getState().addConfirm(payload);
        return { ack: true };
      },
    );
    const offAsk = on<PendingAskUserRequest, { ack: true }>(
      CHANNELS.TOOL_ASK_USER_REQUEST,
      (payload) => {
        useToolInbox.getState().addAsk(payload);
        return { ack: true };
      },
    );
    const offTimeline = on<TimelinePayload, { ack: true }>(
      CHANNELS.TOOL_TIMELINE_EVENT,
      (payload) => {
        useToolInbox.getState().upsertTimeline(payload);
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
