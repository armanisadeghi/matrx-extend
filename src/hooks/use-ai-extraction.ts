import { useActiveTab } from '@/hooks/use-active-tab';
import { type AgentStartRequest, agentExecutePath, mandateExecutePath } from '@/lib/api/routes/ai';
import { requireRequestOrganizationId } from '@/lib/api/routes/auth';
import { aiExtractCapturePage } from '@/lib/data-pattern/modes/ai-extract';
import { parseAgentResponse } from '@/lib/data-pattern/run-interactive';
import type { ExtractedRow } from '@/lib/data-pattern/types';
import { newId } from '@/lib/id';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { createStreamWatchdog } from '@/lib/stream/watchdog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Total stream silence before the extraction is declared stalled. */
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

interface ExtractInput {
  agentId: string;
  mandateKey?: string;
  description: string;
  outputSchema: object;
}

/**
 * Drive the structured-extractor agent. Captures page text from the active
 * tab, posts to /ai/agent/{agentId} with the extraction variables, accumulates
 * the streamed JSON response, and parses it on done.
 *
 * Distinct from useChatStream — this hook does NOT write to the chat store.
 * It listens on the same STREAM_CHUNK channel but filters by its own runId
 * so the two surfaces don't collide.
 */
export function useAiExtraction() {
  const tab = useActiveTab();
  const [rows, setRows] = useState<ExtractedRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);

  const runIdRef = useRef<string | null>(null);
  const accumRef = useRef('');

  // Dead-man's switch: if the server goes silent without a terminal `done`,
  // the spinner used to spin forever (audit K1). Any chunk for our run
  // touches it; STALL_MS of silence kills the run with a visible error.
  const watchdog = useMemo(
    () =>
      createStreamWatchdog({
        stallMs: STALL_MS,
        onStall: () => {
          const runId = runIdRef.current;
          runIdRef.current = null;
          accumRef.current = '';
          setRunning(false);
          setError('Extraction stalled — no response from the server. Try again.');
          if (runId) void send(CHANNELS.STREAM_CANCEL, { runId }).catch(() => {});
        },
      }),
    [],
  );
  useEffect(() => () => watchdog.stop(), [watchdog]);

  useEffect(() => {
    return on<StreamChunk, { ack: true }>(CHANNELS.STREAM_CHUNK, (chunk) => {
      // Capture the id ONCE — cancel() can null runIdRef between this check
      // and the state writes below, and a cancelled run's `done` must not
      // commit stale rows (audit K2).
      const activeRunId = runIdRef.current;
      if (!activeRunId || chunk.runId !== activeRunId) return { ack: true };
      watchdog.touch();

      if (chunk.type === 'text' && chunk.payload.content) {
        accumRef.current += chunk.payload.content;
      } else if (chunk.type === 'error') {
        watchdog.stop();
        setError(chunk.payload.message ?? 'stream error');
        setRunning(false);
        runIdRef.current = null;
      } else if (chunk.type === 'done') {
        watchdog.stop();
        if (runIdRef.current !== activeRunId) return { ack: true }; // cancelled mid-flight
        try {
          const parsed = parseAgentResponse(accumRef.current);
          setRows(parsed.rows);
          setNotes(parsed.notes ?? null);
          setConfidence(parsed.confidence ?? null);
        } catch (e) {
          setError(`Could not parse agent response: ${e instanceof Error ? e.message : String(e)}`);
        }
        setRunning(false);
        runIdRef.current = null;
      }
      return { ack: true };
    });
  }, [watchdog]);

  const extract = useCallback(
    async (input: ExtractInput) => {
      if (!tab.id) {
        setError('No active tab.');
        return;
      }
      if (!input.agentId) {
        setError('No extraction agent selected.');
        return;
      }

      setRunning(true);
      setError(null);
      setRows(null);
      setNotes(null);
      setConfidence(null);
      accumRef.current = '';

      let captured: ReturnType<typeof aiExtractCapturePage>;
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: aiExtractCapturePage,
        });
        captured = result?.[0]?.result as ReturnType<typeof aiExtractCapturePage>;
        if (!captured) throw new Error('Page capture returned nothing.');
      } catch (e) {
        setError(`Could not read page: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
        return;
      }

      const runId = newId('extract');
      runIdRef.current = runId;

      let organizationId: string;
      try {
        organizationId = await requireRequestOrganizationId();
      } catch (e) {
        setError(`Could not initialize workspace: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
        runIdRef.current = null;
        return;
      }

      const body: AgentStartRequest = {
        organization_id: organizationId,
        user_input: input.description,
        // Required on every start request; a one-shot run still mints an id
        // (correlation) and stays ephemeral via store:false.
        conversation_id: crypto.randomUUID(),
        is_new: true,
        variables: {
          page_url: captured.url,
          page_text: captured.page_text,
          page_metadata: captured.page_metadata,
          output_schema: input.outputSchema,
        },
        context: { page_title: captured.title },
        stream: true,
        store: false,
        source_app: 'matrx-extend',
        source_feature: 'data-ai-extract',
        // No browser-dom capability needed — this flow is pure extraction
        // against page text we already captured. The server runs without
        // any client-side tool round-trips.
      };

      try {
        await send(CHANNELS.STREAM_START, {
          runId,
          endpoint: input.mandateKey
            ? mandateExecutePath(input.mandateKey)
            : agentExecutePath(input.agentId),
          body,
          parser: 'rich-events' as const,
          agentName: null,
          permissionMode: 'auto',
        });
        watchdog.start();
      } catch (e) {
        setError(`Failed to start extraction: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
        runIdRef.current = null;
      }
    },
    [tab.id, watchdog],
  );

  const cancel = useCallback(async () => {
    if (!runIdRef.current) return;
    const runId = runIdRef.current;
    // Null the ref BEFORE awaiting — a `done` chunk racing the cancel must
    // not commit stale rows (audit K2). Clear results so a cancelled run
    // doesn't keep displaying the previous run's output.
    runIdRef.current = null;
    accumRef.current = '';
    watchdog.stop();
    setRunning(false);
    setRows(null);
    setNotes(null);
    setConfidence(null);
    setError(null);
    await send(CHANNELS.STREAM_CANCEL, { runId });
  }, [watchdog]);

  const reset = useCallback(() => {
    setRows(null);
    setError(null);
    setNotes(null);
    setConfidence(null);
  }, []);

  return { rows, running, error, notes, confidence, extract, cancel, reset };
}
