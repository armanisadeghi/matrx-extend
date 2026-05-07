/**
 * Bridge: receive PARALLEL_RUN_EVENT broadcasts from the SW (where the
 * `parallel_for_each_tab` handler runs) and apply them to the
 * sidepanel-side zustand store.
 *
 * Mounted once in `App.tsx` so events fire regardless of whether the user
 * has opened the Tasks tab yet — by the time they switch, the panel
 * already has up-to-date state.
 *
 * Lives in a standalone, tiny hook file (rather than in the panel
 * component itself) so the eager sidepanel bundle can mount the listener
 * without pulling in the lazy Tasks tab chunk.
 */

import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  type ParallelSession,
  type ParallelSubRun,
  useParallelRunsStore,
} from '@/state/parallel-runs';
import { useEffect } from 'react';

interface ParallelEventPayload {
  parentCallId: string;
  kind:
    | 'session_started'
    | 'subrun_started'
    | 'subrun_opened'
    | 'subrun_text'
    | 'subrun_data'
    | 'subrun_completed'
    | 'subrun_error'
    | 'subrun_timeout'
    | 'session_finished';
  payload: Record<string, unknown>;
}

export function useParallelEventBridge(): void {
  useEffect(() => {
    return on<ParallelEventPayload, { ack: true }>(
      CHANNELS.PARALLEL_RUN_EVENT,
      (event) => {
        const store = useParallelRunsStore.getState();
        const { parentCallId, kind, payload } = event;
        const session = store.sessions[parentCallId];
        if (kind === 'session_started') {
          if (!session) {
            store.upsertSession({
              parentRunId: String(payload.parentRunId ?? ''),
              parentCallId,
              subPrompt: String(payload.subPrompt ?? ''),
              timeoutMs: Number(payload.timeoutMs ?? 60000),
              mergeStrategy:
                (payload.mergeStrategy as ParallelSession['mergeStrategy']) ??
                'per_tab',
              startedAt: Date.now(),
              endedAt: null,
              subRuns: {},
            });
          }
        } else if (kind === 'subrun_started') {
          // Re-read session after possible session_started branch above.
          const cur = useParallelRunsStore.getState().sessions[parentCallId];
          if (!cur) return { ack: true };
          const sub = payload as unknown as ParallelSubRun;
          if (!sub.runId) return { ack: true };
          useParallelRunsStore.getState().upsertSession({
            ...cur,
            subRuns: { ...cur.subRuns, [sub.runId]: sub },
          });
        } else if (kind === 'subrun_opened') {
          const runId = String(payload.runId ?? '');
          store.patchSubRun(parentCallId, runId, {
            conversationId: (payload.conversationId as string | null) ?? null,
            status: 'running',
          });
        } else if (kind === 'subrun_text') {
          const runId = String(payload.runId ?? '');
          const content = String(payload.content ?? '');
          if (content) store.appendSubRunText(parentCallId, runId, content);
        } else if (kind === 'subrun_data') {
          const runId = String(payload.runId ?? '');
          const data = (payload.data ?? {}) as Record<string, unknown>;
          store.pushSubRunData(parentCallId, runId, data);
        } else if (kind === 'subrun_completed') {
          const runId = String(payload.runId ?? '');
          store.patchSubRun(parentCallId, runId, {
            status: 'completed',
            text: String(payload.text ?? ''),
            error: null,
            endedAt: Number(payload.endedAt ?? Date.now()),
            conversationId: (payload.conversationId as string | null) ?? null,
          });
        } else if (kind === 'subrun_error') {
          const runId = String(payload.runId ?? '');
          store.patchSubRun(parentCallId, runId, {
            status: 'error',
            error: String(payload.error ?? 'unknown error'),
            endedAt: Number(payload.endedAt ?? Date.now()),
          });
        } else if (kind === 'subrun_timeout') {
          const runId = String(payload.runId ?? '');
          store.patchSubRun(parentCallId, runId, {
            status: 'timeout',
            error: String(payload.error ?? 'timed out'),
            endedAt: Number(payload.endedAt ?? Date.now()),
          });
        } else if (kind === 'session_finished') {
          store.finishSession(parentCallId);
        }
        return { ack: true };
      },
    );
  }, []);
}
