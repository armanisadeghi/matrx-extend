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
  CaptureCredentialRequest,
  CaptureCredentialResponse,
} from '@/lib/tools/handlers/credential-capture';
import type {
  AskUserResponse,
  ConfirmResponse,
  PendingAskUserRequest,
  PendingConfirmRequest,
} from '@/lib/tools/types';
import type { ToolProgressUpdate } from '@/lib/tools/types';
import { type ChatMessage, type ToolPartCall, useChatStore } from '@/state/chat';
import { usePilotChatStore } from '@/state/pilot-chat';
import { useToolInbox } from '@/state/tool-inbox';
import { useEffect } from 'react';

export interface TimelinePayload {
  callId: string;
  /**
   * Conversation that owns this call (the dispatcher's ctx.conversationId).
   * Null for runs whose STREAM_OPENED hasn't resolved yet and for paths with
   * no conversation (WebMCP). Non-null values are filtered against the
   * selected conversation — without this, a run surviving a conversation
   * switch attached its tool args/results to the LAST assistant message of
   * whatever conversation the user switched TO (audit P1-11).
   */
  conversationId?: string | null;
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
function activeAssistantMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant') return m;
  }
  return null;
}

type TimelineStore = 'assistant' | 'pilot';

interface TimelineOwner {
  store: TimelineStore;
  messageId: string;
}

/**
 * Resolve an update to the message that already owns this call. A call id is
 * the durable identity; conversationId prevents the (very unlikely) case of
 * the same provider call id being reused in two loaded conversations.
 */
function findExistingOwner(
  store: TimelineStore,
  messages: ChatMessage[],
  payload: TimelinePayload,
): TimelineOwner | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    if (
      payload.conversationId != null &&
      message.conversationId != null &&
      message.conversationId !== payload.conversationId
    ) {
      continue;
    }
    if (message.parts?.some((p) => p.type === 'tool' && p.tool.callId === payload.callId)) {
      return { store, messageId: message.id };
    }
  }
  return null;
}

/**
 * Pick the surface for a brand-new `started` event. Terminal/progress events
 * never use this fallback: attaching a completion to "the latest bubble" is
 * exactly how approval/resume races left the original row spinning forever.
 */
function findStartedFallback(payload: TimelinePayload): TimelineOwner | null {
  const chat = useChatStore.getState();
  const pilot = usePilotChatStore.getState();
  const candidates: Array<{ owner: TimelineOwner; message: ChatMessage }> = [];
  const addCandidate = (
    store: TimelineStore,
    selectedConversationId: string | null,
    messages: ChatMessage[],
  ) => {
    if (
      payload.conversationId != null &&
      selectedConversationId !== payload.conversationId
    ) {
      return;
    }
    const message = activeAssistantMessage(messages);
    if (message) candidates.push({ owner: { store, messageId: message.id }, message });
  };
  addCandidate('assistant', chat.selectedConversationId, chat.messages);
  addCandidate('pilot', pilot.selectedConversationId, pilot.messages);
  candidates.sort((a, b) => b.message.timestamp - a.message.timestamp);
  return candidates[0]?.owner ?? null;
}

/** Exported for focused regression tests; the subscription delegates here. */
export function routeToolTimelineEvent(payload: TimelinePayload): void {
  // Decorative broadcasts from manual surfaces omit conversationId. They are
  // not dispatcher transcript events and must not create chat rows.
  if (payload.conversationId === undefined) return;

  const chat = useChatStore.getState();
  const pilot = usePilotChatStore.getState();
  const owner =
    findExistingOwner('assistant', chat.messages, payload) ??
    findExistingOwner('pilot', pilot.messages, payload) ??
    (payload.phase === 'started' && !payload.progress ? findStartedFallback(payload) : null);
  if (!owner) return;

  const target = owner.store === 'pilot' ? usePilotChatStore.getState() : useChatStore.getState();
  if (payload.progress) {
    target.appendToolProgress(
      owner.messageId,
      payload.callId,
      { at: Date.now(), ...payload.progress },
      { toolName: payload.toolName, kind: 'client' },
    );
    return;
  }

  const patch: Partial<ToolPartCall> & { kind: 'client' } = {
    kind: 'client',
    toolName: payload.toolName,
    phase: payload.phase,
  };
  if (payload.args !== undefined) patch.args = payload.args;
  if (payload.output !== undefined) patch.result = payload.output;
  if (payload.message !== undefined) patch.message = payload.message;
  target.upsertToolPart(owner.messageId, payload.callId, patch);
}

/**
 * Context-singleton guard. ChatView AND PilotView both call this hook and
 * both are forceMounted — two live subscriptions meant every tool-progress
 * entry appended twice (the other handlers are idempotent by callId, but
 * appendToolProgress is a blind append). Refcounted so the listeners exist
 * exactly once per JS context regardless of how many surfaces subscribe.
 */
let subscriberCount = 0;
let unsubscribeAll: (() => void) | null = null;

export function useToolInbox$Subscribe(): void {
  useEffect(() => {
    subscriberCount += 1;
    if (subscriberCount > 1) {
      return () => {
        subscriberCount -= 1;
      };
    }
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
    // The SW failed the call closed (timeout, or it expired across an SW
    // restart) — drop the card so the user isn't left clicking into the void.
    const offExpired = on<{ callId: string; reason?: string }, { ack: true }>(
      CHANNELS.TOOL_CONFIRM_EXPIRED,
      (payload) => {
        useToolInbox.getState().removeConfirm(payload.callId);
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
    // On-the-fly credential CAPTURE (D-11): render a username/password box for
    // the user. The card writes the typed value straight to the vault; the SW
    // only ever learns the outcome.
    const offCapture = on<CaptureCredentialRequest, { ack: true }>(
      CHANNELS.TOOL_CAPTURE_CREDENTIAL_REQUEST,
      (payload) => {
        const conversationId =
          payload.conversationId ?? useChatStore.getState().selectedConversationId;
        useToolInbox.getState().addCapture(payload, conversationId);
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
        routeToolTimelineEvent(payload);
        return { ack: true };
      },
    );
    unsubscribeAll = () => {
      offConfirm();
      offExpired();
      offAsk();
      offCapture();
      offTimeline();
    };
    return () => {
      subscriberCount -= 1;
      if (subscriberCount === 0) {
        unsubscribeAll?.();
        unsubscribeAll = null;
      }
    };
  }, []);
}

export function respondToConfirm(
  callId: string,
  decision: 'allow' | 'deny',
  rememberFor?: 'session' | 'conversation',
): void {
  useToolInbox.getState().removeConfirm(callId);
  const res: ConfirmResponse = {
    callId,
    decision,
    ...(rememberFor !== undefined ? { rememberFor } : {}),
  };
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

/**
 * Answer a credential-capture card. The card has ALREADY written the credential
 * (values went card → server directly); this only reports the outcome to the SW.
 * NEVER carries a value.
 */
export function respondToCapture(
  callId: string,
  reply: Omit<CaptureCredentialResponse, 'callId'>,
): void {
  useToolInbox.getState().removeCapture(callId);
  const res: CaptureCredentialResponse = { callId, ...reply };
  broadcast(CHANNELS.TOOL_CAPTURE_CREDENTIAL_RESPONSE, res);
}
