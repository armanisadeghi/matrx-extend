import { isCurrentPageIdentity, useActiveTab } from '@/hooks/use-active-tab';
import { type ExtractionSource, sourceFromUrl } from '@/hooks/use-extraction';
import { type AgentStartRequest, agentExecutePath, mandateExecutePath } from '@/lib/api/routes/ai';
import { aiExtractCapturePage } from '@/lib/data-pattern/modes/ai-extract';
import { pageCaptureOfferedValues } from '@/lib/data-pattern/page-capture-offer';
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
  const [previewConfig, setPreviewConfig] = useState<Record<string, unknown> | null>(null);
  const [source, setSource] = useState<ExtractionSource | null>(null);
  const [previewPageKey, setPreviewPageKey] = useState<string | null>(null);

  const runIdRef = useRef<string | null>(null);
  const accumRef = useRef('');
  const runConfigRef = useRef<Record<string, unknown> | null>(null);
  const runSourceRef = useRef<ExtractionSource | null>(null);
  const runPageKeyRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const pageKey = tab.pageKey ?? '';

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
      if (!activeRunId || chunk.runId !== activeRunId || !isCurrentPageIdentity(runPageKeyRef.current)) return { ack: true };
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
          setPreviewConfig(runConfigRef.current);
          setSource(runSourceRef.current);
          setPreviewPageKey(runPageKeyRef.current);
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
      if (!tab.id || !tab.documentId || !tab.pageKey) {
        setError(tab.identityError ?? 'Page identity is unavailable. Reload the page and retry.');
        return;
      }
      if (!input.agentId) {
        setError('No extraction agent selected.');
        return;
      }

      setRunning(true);
      setError(null);
      setRows(null);
      setPreviewConfig(null);
      setSource(null);
      setPreviewPageKey(null);
      setNotes(null);
      setConfidence(null);
      accumRef.current = '';
      const requestSeq = ++requestSeqRef.current;

      let captured: ReturnType<typeof aiExtractCapturePage>;
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id, documentIds: [tab.documentId] },
          func: aiExtractCapturePage,
        });
        captured = result?.[0]?.result as ReturnType<typeof aiExtractCapturePage>;
        if (!captured) throw new Error('Page capture returned nothing.');
        if (requestSeq !== requestSeqRef.current || !isCurrentPageIdentity(pageKey)) return;
      } catch (e) {
        if (requestSeq !== requestSeqRef.current) return;
        setError(`Could not read page: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
        return;
      }

      const runId = newId('extract');
      runIdRef.current = runId;
      runConfigRef.current = {
        description: input.description,
        output_schema: input.outputSchema,
        ...(input.mandateKey ? { mandate_key: input.mandateKey } : { agent_id: input.agentId }),
      };
      runSourceRef.current = sourceFromUrl(captured.url);
      runPageKeyRef.current = pageKey;

      const body: AgentStartRequest = {
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
          // extend.page_capture offered values — Mandate door only (see
          // page-capture-offer.ts): a picked agent may already use these names.
          ...(input.mandateKey
            ? pageCaptureOfferedValues({
                pageMetadata: captured.page_metadata,
                extractionDescription: input.description,
                tabId: tab.id,
              })
            : {}),
        },
        context: { page_title: captured.title },
        stream: true,
        store: false,
        source_app: 'matrx-extend',
        source_feature: 'data-ai-extract',
        // 'user': `extract()` has exactly one caller — the Extract button in
        // AiExtractTab. Nothing schedules or effect-fires this hook. If an
        // automated driver is added, thread an option; don't inherit this.
        initiation: 'user',
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
        if (requestSeq !== requestSeqRef.current || !isCurrentPageIdentity(pageKey)) return;
        setError(`Failed to start extraction: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
        runIdRef.current = null;
      }
    },
    [tab.id, tab.url, tab.documentId, pageKey, watchdog],
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
    setPreviewConfig(null);
    setSource(null);
    setPreviewPageKey(null);
    setNotes(null);
    setConfidence(null);
    setError(null);
    await send(CHANNELS.STREAM_CANCEL, { runId });
  }, [watchdog]);

  const reset = useCallback(() => {
    setRows(null);
    setPreviewConfig(null);
    setSource(null);
    setPreviewPageKey(null);
    setError(null);
    setNotes(null);
    setConfidence(null);
  }, []);

  // A response belongs to the page captured at run start. Navigation also
  // invalidates in-flight captures and streamed responses.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab identity is the invalidation key.
  useEffect(() => {
    requestSeqRef.current += 1;
    const runId = runIdRef.current;
    runIdRef.current = null;
    if (runId) void send(CHANNELS.STREAM_CANCEL, { runId }).catch(() => {});
    watchdog.stop();
    setRows(null);
    setPreviewConfig(null);
    setSource(null);
    setPreviewPageKey(null);
    setNotes(null);
    setConfidence(null);
    setError(null);
    setRunning(false);
  }, [pageKey, watchdog]);

  const previewIsCurrentPage = Boolean(tab.pageKey) && previewPageKey === pageKey;
  return {
    rows: previewIsCurrentPage ? rows : null,
    running,
    error,
    notes,
    confidence,
    previewConfig: previewIsCurrentPage ? previewConfig : null,
    source: previewIsCurrentPage ? source : null,
    extract,
    cancel,
    reset,
  };
}
