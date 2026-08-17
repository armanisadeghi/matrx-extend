/**
 * One-shot ephemeral agent run that streams PLAIN TEXT back to a non-chat
 * surface.
 *
 * This is the generic primitive behind "a side-panel tab wants an agent to
 * write something into a panel" — the SEO tab's recommendations are its first
 * consumer. It is deliberately NOT `useChatStream`: nothing here touches the
 * chat store, no user/assistant bubbles are pushed, no conversation is
 * persisted, and no browser-dom capability is advertised (the caller ships
 * everything the model needs in `context`).
 *
 * It listens on the same `STREAM_CHUNK` channel as every other surface and
 * filters by its own runId, exactly like `useAiExtraction` /
 * `usePatternFromData` — the difference is that those two accumulate JSON and
 * parse it at `done`, while this one exposes the text AS IT ARRIVES so the
 * surface can render a live stream.
 *
 * Contract notes that are NOT optional (aidream 422s otherwise, see
 * CLAUDE.md): every start request sends `conversation_id` (client-minted),
 * `is_new`, and `store`. `store: false` is what makes the run ephemeral — a
 * missing conversation id does not, and is rejected.
 */

import { type AgentStartRequest, agentTargetExecutePath } from '@/lib/api/routes/ai';
import { resolveConversationOrganizationId } from '@/lib/api/routes/auth';
import { log } from '@/lib/debug/log';
import { newId } from '@/lib/id';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { createStreamWatchdog } from '@/lib/stream/watchdog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Total stream silence before the run is declared stalled. Mirrors chat. */
const STALL_MS = 75_000;

interface StreamChunk {
  runId: string;
  type: 'text' | 'reasoning' | 'event' | 'error' | 'done';
  payload: {
    content?: string;
    eventName?: string;
    data?: Record<string, unknown>;
    message?: string;
  };
}

export interface AgentTextRunInput {
  /** Agent to run. Resolved by the caller (surface default / user pick). */
  agentId: string;
  /** Body for the start request, minus the transport bits this hook owns. */
  body: Omit<AgentStartRequest, 'stream' | 'organization_id'>;
  /** Prefix for the generated runId — shows up in stream logs. */
  runIdPrefix?: string;
}

export interface AgentTextRun {
  /** Text accumulated so far. Non-empty while streaming. */
  text: string;
  running: boolean;
  /** Human-readable failure. Never null-and-silent: every failure path sets this. */
  error: string | null;
  /** True once a run finished cleanly with at least one character of output. */
  done: boolean;
  run: (input: AgentTextRunInput) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export function useAgentTextRun(): AgentTextRun {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const runIdRef = useRef<string | null>(null);
  // Authoritative accumulation. `text` mirrors it for rendering; the ref is
  // what the `done` handler inspects (a state updater must stay pure).
  const accumRef = useRef('');

  const watchdog = useMemo(
    () =>
      createStreamWatchdog({
        stallMs: STALL_MS,
        onStall: () => {
          const runId = runIdRef.current;
          if (!runId) return;
          runIdRef.current = null;
          setRunning(false);
          setError('The agent stopped responding. Try again.');
          void send(CHANNELS.STREAM_CANCEL, { runId }).catch(() => {});
        },
      }),
    [],
  );
  useEffect(() => () => watchdog.stop(), [watchdog]);

  useEffect(() => {
    return on<StreamChunk, { ack: true }>(CHANNELS.STREAM_CHUNK, (chunk) => {
      // Capture once — cancel() can null the ref between this check and the
      // state writes below, and a cancelled run must not resurrect its output.
      const activeRunId = runIdRef.current;
      if (!activeRunId || chunk.runId !== activeRunId) return { ack: true };
      watchdog.touch();

      if (chunk.type === 'text') {
        if (chunk.payload.content) {
          accumRef.current += chunk.payload.content;
          setText(accumRef.current);
        }
      } else if (chunk.type === 'error') {
        watchdog.stop();
        runIdRef.current = null;
        setError(chunk.payload.message ?? 'The agent run failed.');
        setRunning(false);
      } else if (chunk.type === 'done') {
        watchdog.stop();
        runIdRef.current = null;
        setRunning(false);
        // An empty completion is a FAILURE, not a result. Rendering an empty
        // panel here would be the same dead end this surface exists to kill.
        if (accumRef.current.trim().length === 0) {
          setError('The agent returned nothing. Try again.');
        } else {
          setDone(true);
        }
      }
      return { ack: true };
    });
  }, [watchdog]);

  const run = useCallback(
    async (input: AgentTextRunInput) => {
      if (!input.agentId) {
        setError('No agent available to run. Pick a default agent in Settings.');
        return;
      }
      setRunning(true);
      setError(null);
      setDone(false);
      accumRef.current = '';
      setText('');

      const runId = newId(input.runIdPrefix ?? 'agentrun');
      runIdRef.current = runId;

      try {
        const organizationId = await resolveConversationOrganizationId();
        await send(CHANNELS.STREAM_START, {
          runId,
          endpoint: agentTargetExecutePath(input.agentId),
          body: {
            ...input.body,
            organization_id: organizationId,
            stream: true,
          } satisfies AgentStartRequest,
          parser: 'rich-events' as const,
          agentName: null,
          permissionMode: 'auto',
        });
        watchdog.start();
      } catch (e) {
        // The STREAM_START handoff resolves only when the SSE finishes, so a
        // rejection AFTER chunks arrived is a benign port death — the run is
        // alive in the offscreen doc. Only a failure while we still own the
        // run and have nothing on screen means it never started.
        if (runIdRef.current !== runId) return;
        log.error('stream', `agent text run failed to start (${runId})`, e);
        watchdog.stop();
        runIdRef.current = null;
        setRunning(false);
        setError(`Could not start the agent: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [watchdog],
  );

  const cancel = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) return;
    // Null the ref BEFORE awaiting so a racing `done` can't flip us back to a
    // finished state.
    runIdRef.current = null;
    watchdog.stop();
    setRunning(false);
    await send(CHANNELS.STREAM_CANCEL, { runId }).catch(() => {});
  }, [watchdog]);

  const reset = useCallback(() => {
    accumRef.current = '';
    setText('');
    setError(null);
    setDone(false);
  }, []);

  return { text, running, error, done, run, cancel, reset };
}
