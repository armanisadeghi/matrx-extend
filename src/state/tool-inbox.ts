/**
 * Sidepanel-side inbox of in-flight client-tool calls.
 *
 *   - `pendingConfirms`   — approval cards waiting on user click
 *   - `pendingAsks`       — agent → human questions waiting on a typed answer
 *   - `timeline`          — every tool started/completed/error, keyed by callId,
 *                          rendered inline in chat between messages
 *
 * Populated by `useToolInbox()` via chrome.runtime broadcasts. Consumed by
 * ChatView to render the cards in their natural place in the conversation.
 */

import type { PendingAskUserRequest, PendingConfirmRequest } from '@/lib/tools/types';
import { create } from 'zustand';

export type TimelinePhase = 'started' | 'completed' | 'error';

export interface ToolTimelineEntry {
  callId: string;
  toolName: string;
  startedAt: number;
  endedAt?: number;
  phase: TimelinePhase;
  /** Inputs the agent sent. Surfaced in the card header. */
  args?: unknown;
  /** Output of the call (for completed). May be large — UI clips itself. */
  output?: unknown;
  /** Error message (for error). */
  message?: string;
}

interface ToolInboxState {
  pendingConfirms: PendingConfirmRequest[];
  pendingAsks: PendingAskUserRequest[];
  timeline: ToolTimelineEntry[];

  addConfirm: (req: PendingConfirmRequest) => void;
  removeConfirm: (callId: string) => void;
  addAsk: (req: PendingAskUserRequest) => void;
  removeAsk: (callId: string) => void;
  upsertTimeline: (entry: Partial<ToolTimelineEntry> & { callId: string }) => void;
  clearForConversation: () => void;
}

export const useToolInbox = create<ToolInboxState>((set) => ({
  pendingConfirms: [],
  pendingAsks: [],
  timeline: [],

  addConfirm: (req) =>
    set((s) => {
      if (s.pendingConfirms.some((r) => r.callId === req.callId)) return s;
      return { pendingConfirms: [...s.pendingConfirms, req] };
    }),
  removeConfirm: (callId) =>
    set((s) => ({ pendingConfirms: s.pendingConfirms.filter((r) => r.callId !== callId) })),

  addAsk: (req) =>
    set((s) => {
      if (s.pendingAsks.some((r) => r.callId === req.callId)) return s;
      return { pendingAsks: [...s.pendingAsks, req] };
    }),
  removeAsk: (callId) =>
    set((s) => ({ pendingAsks: s.pendingAsks.filter((r) => r.callId !== callId) })),

  upsertTimeline: (entry) =>
    set((s) => {
      const existing = s.timeline.find((t) => t.callId === entry.callId);
      if (!existing) {
        return {
          timeline: [
            ...s.timeline,
            {
              callId: entry.callId,
              toolName: entry.toolName ?? '(unknown)',
              startedAt: Date.now(),
              phase: entry.phase ?? 'started',
              args: entry.args,
              output: entry.output,
              message: entry.message,
              endedAt:
                entry.phase === 'completed' || entry.phase === 'error' ? Date.now() : undefined,
            },
          ],
        };
      }
      const merged: ToolTimelineEntry = {
        ...existing,
        ...entry,
        endedAt:
          entry.phase === 'completed' || entry.phase === 'error' ? Date.now() : existing.endedAt,
      };
      return {
        timeline: s.timeline.map((t) => (t.callId === entry.callId ? merged : t)),
      };
    }),

  clearForConversation: () => set({ pendingConfirms: [], pendingAsks: [], timeline: [] }),
}));
