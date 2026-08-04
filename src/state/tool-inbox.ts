/**
 * Sidepanel-side inbox of in-flight CLIENT tool calls.
 *
 *   - `pendingConfirms` — approval cards waiting on user click
 *   - `pendingAsks`     — agent → human questions waiting on a typed answer
 *
 * NOTE: as of 2026-05-03 the global `timeline` was REMOVED. Tool
 * started/completed/error events now flow into the parts array of the
 * active assistant message in `useChatStore`. That fixes:
 *   1. Order — tools render exactly where they fired, between text/reasoning
 *      parts, instead of piling up in a separate block.
 *   2. Conversation isolation — switching conversations swaps the message
 *      list, so tool entries naturally disappear with their parent message.
 *
 * Pending cards (`pendingConfirms`, `pendingAsks`) still live in this store
 * because they're INTERACTIVE — the user has to click before they disappear.
 * Both are tagged with the conversation_id they belong to; the renderer
 * filters by current conversation, and `clearForConversation` is called on
 * conversation switch as a hard reset.
 */

import type { PendingAskUserRequest, PendingConfirmRequest } from '@/lib/tools/types';
import { create } from 'zustand';

export interface PendingConfirmInbox extends PendingConfirmRequest {
  /** Conversation this card belongs to. Null = pre-conversation (first turn). */
  conversationId: string | null;
}

export interface PendingAskInbox extends PendingAskUserRequest {
  conversationId: string | null;
}

interface ToolInboxState {
  pendingConfirms: PendingConfirmInbox[];
  pendingAsks: PendingAskInbox[];

  addConfirm: (req: PendingConfirmRequest, conversationId: string | null) => void;
  removeConfirm: (callId: string) => void;
  addAsk: (req: PendingAskUserRequest, conversationId: string | null) => void;
  removeAsk: (callId: string) => void;
  /** Wipe everything (used on conversation switch / sign-out). */
  resetAll: () => void;
  /**
   * Drop only the cards owned by ONE conversation. Conversation switches
   * must use this, not resetAll — the inbox is SHARED between the Assistant
   * and Pilot surfaces (both forceMounted), and a "New chat" in one surface
   * used to vaporize the OTHER surface's pending approval card, hanging its
   * run until the SW's 5-minute timeout.
   */
  clearForConversation: (conversationId: string | null) => void;
}

export const useToolInbox = create<ToolInboxState>((set) => ({
  pendingConfirms: [],
  pendingAsks: [],

  addConfirm: (req, conversationId) =>
    set((s) => {
      if (s.pendingConfirms.some((r) => r.callId === req.callId)) return s;
      return {
        pendingConfirms: [...s.pendingConfirms, { ...req, conversationId }],
      };
    }),
  removeConfirm: (callId) =>
    set((s) => ({
      pendingConfirms: s.pendingConfirms.filter((r) => r.callId !== callId),
    })),

  addAsk: (req, conversationId) =>
    set((s) => {
      if (s.pendingAsks.some((r) => r.callId === req.callId)) return s;
      return { pendingAsks: [...s.pendingAsks, { ...req, conversationId }] };
    }),
  removeAsk: (callId) =>
    set((s) => ({
      pendingAsks: s.pendingAsks.filter((r) => r.callId !== callId),
    })),

  resetAll: () => set({ pendingConfirms: [], pendingAsks: [] }),

  clearForConversation: (conversationId) =>
    set((s) => ({
      pendingConfirms: s.pendingConfirms.filter((r) => r.conversationId !== conversationId),
      pendingAsks: s.pendingAsks.filter((r) => r.conversationId !== conversationId),
    })),
}));
