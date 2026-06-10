/**
 * State for `parallel_for_each_tab` orchestrations.
 *
 * Owns N parallel "sub-runs" — each one a fresh agent stream pinned to a
 * specific tab. The handler in `src/lib/tools/handlers/parallel.ts` writes
 * into this store as each sub-run progresses (started → text deltas →
 * completed / error / timeout). The Tasks tab's `ParallelRunsPanel`
 * subscribes and renders live status + per-sub-run output.
 *
 * Why a separate store from `useChatStore`: the parent chat conversation
 * stays clean — the parent agent's transcript only shows the
 * `parallel_for_each_tab` tool call result. The N child conversations are
 * orchestrational artifacts the human can inspect, not interleaved into
 * the main thread.
 */

import { create } from 'zustand';

export type ParallelSubRunStatus =
  | 'pending' // queued, not yet sent
  | 'running' // STREAM_RUN sent, awaiting events
  | 'completed' // stream done, text accumulated
  | 'error' // stream produced an error event
  | 'timeout'; // wall-clock timeout fired before completion

export interface ParallelSubRun {
  /** Sub-run id (matches the SSE runId we used). */
  runId: string;
  /** Tab pinned for this sub-run. */
  tabId: number;
  tabUrl: string | null;
  tabTitle: string | null;
  /** Server-assigned conversation id, captured from STREAM_OPENED. */
  conversationId: string | null;
  status: ParallelSubRunStatus;
  /** Accumulated assistant text (may be empty for tool-only completions). */
  text: string;
  /** Latest error message, if any. */
  error: string | null;
  /** Number of `data` events received (for json_array merge mode). */
  dataEvents: Array<Record<string, unknown>>;
  /** Started timestamp ms. */
  startedAt: number;
  /** Completed / error / timeout timestamp ms. Null while running. */
  endedAt: number | null;
}

export interface ParallelSession {
  /** Parent run id this orchestration belongs to. */
  parentRunId: string;
  /** Parent tool call id (from the dispatcher's ctx). */
  parentCallId: string;
  /** The user prompt that drives every sub-run. */
  subPrompt: string;
  /** Wall-clock deadline ms per sub-run. */
  timeoutMs: number;
  /** Merge strategy chosen by the caller. */
  mergeStrategy: 'per_tab' | 'concat' | 'json_array';
  /** Started timestamp ms. */
  startedAt: number;
  /** Completed timestamp ms. Null while still running. */
  endedAt: number | null;
  /** Sub-runs by sub-runId. */
  subRuns: Record<string, ParallelSubRun>;
  /** Whether the panel is collapsed (UI affordance). */
  collapsed?: boolean;
}

interface ParallelRunsState {
  sessions: Record<string, ParallelSession>;

  /** Replace or insert a session. */
  upsertSession: (session: ParallelSession) => void;
  /** Mutate a sub-run by parentCallId + runId. */
  patchSubRun: (parentCallId: string, runId: string, patch: Partial<ParallelSubRun>) => void;
  /** Append text to a sub-run's accumulated assistant output. */
  appendSubRunText: (parentCallId: string, runId: string, text: string) => void;
  /** Append a `data` event payload (for json_array merge). */
  pushSubRunData: (parentCallId: string, runId: string, payload: Record<string, unknown>) => void;
  /** Mark the whole session ended. */
  finishSession: (parentCallId: string) => void;
  /** Toggle the collapsed flag for the session. */
  toggleCollapsed: (parentCallId: string) => void;
  /** Drop the session entirely (UI close). */
  removeSession: (parentCallId: string) => void;
  /** Wipe everything (sign-out / reset). */
  resetAll: () => void;
}

export const useParallelRunsStore = create<ParallelRunsState>((set) => ({
  sessions: {},

  upsertSession: (session) =>
    set((s) => ({
      sessions: { ...s.sessions, [session.parentCallId]: session },
    })),

  patchSubRun: (parentCallId, runId, patch) =>
    set((s) => {
      const session = s.sessions[parentCallId];
      if (!session) return s;
      const sub = session.subRuns[runId];
      if (!sub) return s;
      return {
        sessions: {
          ...s.sessions,
          [parentCallId]: {
            ...session,
            subRuns: { ...session.subRuns, [runId]: { ...sub, ...patch } },
          },
        },
      };
    }),

  appendSubRunText: (parentCallId, runId, text) =>
    set((s) => {
      const session = s.sessions[parentCallId];
      if (!session) return s;
      const sub = session.subRuns[runId];
      if (!sub) return s;
      return {
        sessions: {
          ...s.sessions,
          [parentCallId]: {
            ...session,
            subRuns: {
              ...session.subRuns,
              [runId]: { ...sub, text: sub.text + text },
            },
          },
        },
      };
    }),

  pushSubRunData: (parentCallId, runId, payload) =>
    set((s) => {
      const session = s.sessions[parentCallId];
      if (!session) return s;
      const sub = session.subRuns[runId];
      if (!sub) return s;
      return {
        sessions: {
          ...s.sessions,
          [parentCallId]: {
            ...session,
            subRuns: {
              ...session.subRuns,
              [runId]: { ...sub, dataEvents: [...sub.dataEvents, payload] },
            },
          },
        },
      };
    }),

  finishSession: (parentCallId) =>
    set((s) => {
      const session = s.sessions[parentCallId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [parentCallId]: { ...session, endedAt: Date.now() },
        },
      };
    }),

  toggleCollapsed: (parentCallId) =>
    set((s) => {
      const session = s.sessions[parentCallId];
      if (!session) return s;
      return {
        sessions: {
          ...s.sessions,
          [parentCallId]: { ...session, collapsed: !session.collapsed },
        },
      };
    }),

  removeSession: (parentCallId) =>
    set((s) => {
      if (!s.sessions[parentCallId]) return s;
      const next = { ...s.sessions };
      delete next[parentCallId];
      return { sessions: next };
    }),

  resetAll: () => set({ sessions: {} }),
}));
