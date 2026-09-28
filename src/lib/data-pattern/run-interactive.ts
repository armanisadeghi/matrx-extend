/**
 * Interactive pattern runners (audit X1/X2): real one-click re-run for the
 * two kinds whose runInPage is a stub.
 *
 *  - ai_extract: re-executes the saved agent extraction (agent_id /
 *    description / output_schema from pattern.config) against the current
 *    page, via the same offscreen SSE pipeline the AI Extract tab uses.
 *  - network_capture: guided auto re-capture — install the fetch/XHR taps
 *    the moment the reloaded document appears, reload the tab, collect
 *    requests matching the saved url_filter/method during a bounded window,
 *    then apply key_path to the best-matching body.
 *
 * `runSavedPattern` is the single entry point surfaces should call instead
 * of `runPattern` — DOM kinds route straight through to runPattern.
 */

import {
  type AgentStartRequest,
  type RequestInitiation,
  agentExecutePath,
  mandateExecutePath,
} from '@/lib/api/routes/ai';
import { sanitizeNetworkUrl, transientCredentialFingerprint } from '@/lib/credentials/network-urls';
import { newId } from '@/lib/id';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { ExtractionPattern } from '@/lib/supabase/queries';
// THE package formatters (`@ai-matrx/kit/format`, duplication census H1
// 2026-09-07): the fleet had ~35 duration, ~18 relative-time and ~20 byte-size
// twins with no correct owner until kit became one.
import { formatDurationMs } from '@ai-matrx/kit/format';
import { openDocumentNetworkCapture } from './document-network-transport';
import { type JsonKeyPath, formatJsonKeyPath, jsonKeyPathSegments } from './json-key-path';
import { aiExtractCapturePage } from './modes/ai-extract';
import type { CapturedNetEvent } from './network-tap';
import { pageCaptureOfferedValues } from './page-capture-offer';
import { runPattern } from './run-pattern';
import type { ExtractedRow } from './types';

export interface InteractiveRunOptions {
  /** Live progress notes for the UI ("Reloading page…", "Listening…"). */
  onProgress?: (note: string) => void;
  /** Interactive response window; Network setup is separately bounded by the same budget. */
  timeoutMs?: number;
  signal?: AbortSignal;
  maxBodyBytes?: number;
  /** Set only by the canonical prepared operation in the service worker. */
  captureApproved?: boolean;
  expectedPage?: { url: string; documentId: string };
  /** Bound to the clicked document for ordinary DOM/framework runs. */
  documentId?: string;
  /**
   * REQUIRED provenance attestation for any AI request this run opens — see
   * `AgentStartRequest.initiation`. No default: a saved pattern is run BOTH
   * from a Run button (`'user'`) and by the `data_patterns` agent tool
   * (`'auto'`), so the two drivers must declare themselves.
   */
  initiation: RequestInitiation;
}

interface StreamChunk {
  runId: string;
  type: 'text' | 'reasoning' | 'event' | 'error' | 'done';
  payload: { content?: string; message?: string };
}

export interface AiExtractionEnvelope {
  rows: ExtractedRow[];
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
  inferred_schema?: unknown;
}

/**
 * Parse a streamed agent response into the extraction envelope. Tolerates
 * code fences and wrapping prose. (Moved here from use-ai-extraction so the
 * hook and the saved-pattern runner share ONE parser.)
 */
export function parseAgentResponse(raw: string): AiExtractionEnvelope {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('empty response');

  let body = trimmed;
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/m);
  if (fence?.[1]) body = fence[1].trim();

  const firstBrace = body.search(/[{[]/);
  const lastBrace = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    body = body.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(body) as unknown;

  if (Array.isArray(parsed)) {
    return { rows: parsed as ExtractedRow[] };
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const rows = Array.isArray(obj.rows) ? (obj.rows as ExtractedRow[]) : [];
    const confidence = obj.confidence as 'high' | 'medium' | 'low' | undefined;
    const notes = typeof obj.notes === 'string' ? obj.notes : undefined;
    return {
      rows,
      ...(confidence !== undefined && { confidence }),
      ...(notes !== undefined && { notes }),
      ...(obj.inferred_schema !== undefined && { inferred_schema: obj.inferred_schema }),
    };
  }

  throw new Error('agent response was not a JSON object or array');
}

/** Saved ai_extract pattern.config shape (modes/ai-extract.ts schema). */
interface SavedAiConfig {
  agent_id?: string;
  mandate_key?: string;
  description?: string;
  output_schema?: unknown;
}

export async function runAiExtractPattern(
  config: unknown,
  tabId: number,
  opts: InteractiveRunOptions,
): Promise<ExtractedRow[]> {
  const { agent_id, mandate_key, description, output_schema } = (config ?? {}) as SavedAiConfig;
  if ((!agent_id && !mandate_key) || !description) {
    throw new Error('This AI pattern is missing its agent or description — re-save it.');
  }
  const endpoint = mandate_key
    ? mandateExecutePath(mandate_key)
    : agent_id
      ? agentExecutePath(agent_id)
      : null;
  if (!endpoint) {
    throw new Error('This AI pattern has no executable target — re-save it.');
  }

  opts.onProgress?.('Reading page…');
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: aiExtractCapturePage,
  });
  const captured = result?.[0]?.result as ReturnType<typeof aiExtractCapturePage> | undefined;
  if (!captured) throw new Error('Page capture returned nothing.');

  const runId = newId('extract');
  const body: AgentStartRequest = {
    user_input: description,
    // Required on every start request; a one-shot run still mints an id
    // (correlation) and stays ephemeral via store:false.
    conversation_id: crypto.randomUUID(),
    is_new: true,
    variables: {
      page_url: captured.url,
      page_text: captured.page_text,
      page_metadata: captured.page_metadata,
      output_schema: output_schema ?? {},
      // extend.page_capture offered values — Mandate door only (see
      // page-capture-offer.ts): a saved agent_id pattern's agent may already
      // use these names.
      ...(mandate_key
        ? pageCaptureOfferedValues({
            pageMetadata: captured.page_metadata,
            extractionDescription: description,
            tabId,
          })
        : {}),
    },
    context: { page_title: captured.title },
    stream: true,
    store: false,
    source_app: 'matrx-extend',
    source_feature: 'data-ai-extract-rerun',
    // Declared by the driver: the Patterns/Data Run buttons pass 'user', the
    // `data_patterns` agent tool passes 'auto'. Never defaulted here.
    initiation: opts.initiation,
  };

  opts.onProgress?.('Extracting via agent…');
  const stallMs = opts.timeoutMs ?? 75_000;

  return new Promise<ExtractedRow[]>((resolve, reject) => {
    let accum = '';
    let finished = false;
    let stallTimer: ReturnType<typeof setTimeout>;

    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      clearTimeout(stallTimer);
      off();
      fn();
    };
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (typeof window === 'undefined') {
          // SW context — cancel via the proxy directly (see start path).
          void import('@/lib/stream/offscreen-proxy')
            .then((m) => m.cancelStream(runId))
            .catch(() => {});
        } else {
          void send(CHANNELS.STREAM_CANCEL, { runId }).catch(() => {});
        }
        finish(() => reject(new Error('Extraction stalled — no response from the server.')));
      }, stallMs);
    };

    const off = on<StreamChunk, { ack: true }>(CHANNELS.STREAM_CHUNK, (chunk) => {
      if (chunk.runId !== runId) return { ack: true };
      armStall();
      if (chunk.type === 'text' && chunk.payload.content) {
        accum += chunk.payload.content;
      } else if (chunk.type === 'error') {
        finish(() => reject(new Error(chunk.payload.message ?? 'stream error')));
      } else if (chunk.type === 'done') {
        finish(() => {
          try {
            resolve(parseAgentResponse(accum).rows);
          } catch (e) {
            reject(
              new Error(
                `Could not parse agent response: ${e instanceof Error ? e.message : String(e)}`,
              ),
            );
          }
        });
      }
      return { ack: true };
    });

    armStall();
    const startArgs = {
      runId,
      endpoint,
      body,
      parser: 'rich-events' as const,
      agentName: null,
      permissionMode: 'auto',
    };
    // In the SW (data_patterns tool) there is no `window`; STREAM_START's
    // only handler IS this context and sendMessage never self-delivers —
    // the run silently never started, the stall timer fired, and a healthy
    // pattern got marked 'broken'. Call the offscreen proxy directly.
    const startPromise =
      typeof window === 'undefined'
        ? import('@/lib/stream/offscreen-proxy').then((m) =>
            m.startStream(startArgs as Parameters<typeof m.startStream>[0]),
          )
        : send(CHANNELS.STREAM_START, startArgs);
    void startPromise.catch((e) =>
      finish(() => reject(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

/** Saved network_capture pattern.config shape. */
interface SavedNetConfig {
  url_match?: 'exact' | 'filter';
  request_body_key?: string;
  body_match?: 'exact' | 'ignore';
  url_filter?: string;
  credential_query_keys?: string[];
  method?: string;
  key_path?: JsonKeyPath;
}

/**
 * url_filter matching: complete request URLs are exact, while deliberately
 * edited partial filters retain substring matching and * supports globs.
 * Display-list searches are never
 * saved here because they can match content type instead of request URL.
 */
export function matchesUrlFilter(
  url: string,
  filter: string,
  match?: 'exact' | 'filter',
  extraCredentialKeys: readonly string[] = [],
): boolean {
  const candidate = sanitizeNetworkUrl(url, extraCredentialKeys);
  const f = sanitizeNetworkUrl(filter.trim(), extraCredentialKeys);
  if (match === 'exact') return candidate === f;
  if (!f) return true;
  if (!f.includes('*'))
    return match !== 'filter' && /^https?:\/\//i.test(f) ? candidate === f : candidate.includes(f);
  const re = new RegExp(
    f
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*'),
  );
  return re.test(candidate);
}

/** Walk legacy dotted paths or exact JSON-key segments, then shape rows. */
export function rowsFromBody(body: string, keyPath?: JsonKeyPath): ExtractedRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('The captured response body is not JSON.');
  }
  let target: unknown = parsed;
  if (keyPath) {
    for (const part of jsonKeyPathSegments(keyPath)) {
      if (target == null || typeof target !== 'object') break;
      target = (target as Record<string, unknown>)[part];
    }
  }
  if (Array.isArray(target)) {
    return target.map((item) =>
      item && typeof item === 'object' ? (item as ExtractedRow) : { value: item },
    );
  }
  if (target && typeof target === 'object') return [target as ExtractedRow];
  throw new Error(
    keyPath?.length
      ? `Nothing found at key path "${typeof keyPath === 'string' ? keyPath : formatJsonKeyPath(keyPath)}" in the captured response.`
      : 'The captured response was not an object or array.',
  );
}

/**
 * Circumstantial capture outcome: no matching request, ambiguous identities,
 * or an unavailable identity requiring recapture/an explicit broader matcher.
 * Callers should show the remedy without marking the saved pattern broken.
 */
export class NetworkNoMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkNoMatchError';
  }
}

export async function runNetworkCapturePattern(
  config: unknown,
  tabId: number,
  opts: InteractiveRunOptions,
): Promise<ExtractedRow[]> {
  const {
    url_filter,
    url_match,
    credential_query_keys,
    request_body_key,
    body_match,
    method,
    key_path,
  } = (config ?? {}) as SavedNetConfig;
  if (!url_filter) {
    throw new Error('This network pattern has no url_filter — re-save it from the Network tab.');
  }
  const windowMs = opts.timeoutMs ?? 20_000;
  if (
    body_match !== 'ignore' &&
    (request_body_key === 'unavailable' || (body_match === 'exact' && !request_body_key))
  ) {
    throw new NetworkNoMatchError(
      'This request body cannot be matched reliably. Reopen Network capture and explicitly choose URL and method only, or select a request with a stable payload.',
    );
  }

  return new Promise<ExtractedRow[]>((resolve, reject) => {
    let latest: CapturedNetEvent | null = null;
    let matchedIdentity: string | null = null;
    let matchCount = 0;
    const captureId = crypto.randomUUID();
    const captureAbort = new AbortController();
    let capture: Promise<{ close: () => Promise<void> }> | null = null;
    let captureReady = false;
    let finished = false;

    const cleanup: Array<() => void> = [];
    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      for (const c of cleanup) c();
      if (!captureReady) captureAbort.abort();
      void (async () => {
        try {
          await (await capture)?.close();
        } catch (error) {
          reject(new NetworkNoMatchError(error instanceof Error ? error.message : String(error)));
          return;
        }
        fn();
      })();
    };

    const concludeWithMatches = () => {
      const event = latest;
      if (!event) return;
      finish(() => {
        try {
          if (event.body_truncated)
            throw new Error(
              'The matched response was truncated. Capture a smaller response or narrow the request on the page, then save it again.',
            );
          resolve(rowsFromBody(event.body, key_path));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    };

    const consumeEvent = (
      event: CapturedNetEvent & { capture_id: string; document_key: string },
    ) => {
      if (finished || event.capture_id !== captureId || !event.document_key) return { ack: true };
      if (event.tab_id !== tabId) return { ack: true };
      if (!matchesUrlFilter(event.url, url_filter, url_match, credential_query_keys))
        return { ack: true };
      if (method && event.method.toUpperCase() !== method.toUpperCase()) return { ack: true };
      if (
        body_match !== 'ignore' &&
        request_body_key !== undefined &&
        event.request_body_key !== request_body_key
      )
        return { ack: true };
      if (
        body_match !== 'ignore' &&
        request_body_key === undefined &&
        event.request_body_key &&
        event.request_body_key !== 'none'
      ) {
        finish(() =>
          reject(
            new NetworkNoMatchError(
              'This saved pattern has no body identity for this request. Capture and save it again, or explicitly choose URL and method only in Network capture.',
            ),
          ),
        );
        return { ack: true };
      }
      // Failed requests do not replace the newest successful response.
      if (event.status < 200 || event.status >= 300) return { ack: true };
      const bodyKey = event.request_body_key;
      // An unavailable payload has no provable equality with another request.
      const identity = JSON.stringify([
        sanitizeNetworkUrl(event.url, credential_query_keys),
        transientCredentialFingerprint(event.url, credential_query_keys),
        event.method.toUpperCase(),
        bodyKey === 'unavailable'
          ? ['unknown', event.request_sequence, event.ts_ms, matchCount]
          : (bodyKey ?? 'none'),
      ]);
      if (matchedIdentity !== null && identity !== matchedIdentity) {
        finish(() =>
          reject(
            new NetworkNoMatchError(
              'This matcher captured different request identities and is ambiguous. Narrow the URL matcher or include the selected request body identity in Network capture, then save again.',
            ),
          ),
        );
        return { ack: true };
      }
      matchedIdentity = identity;
      matchCount += 1;
      if (
        !latest ||
        (event.request_sequence ?? event.ts_ms) > (latest.request_sequence ?? latest.ts_ms)
      ) {
        latest = event;
      } else if (
        (event.request_sequence ?? event.ts_ms) === (latest.request_sequence ?? latest.ts_ms) &&
        event.body !== latest.body
      ) {
        // Older captures without an ordering field cannot resolve a tie safely.
        try {
          if (
            JSON.stringify(rowsFromBody(event.body, key_path)) !==
            JSON.stringify(rowsFromBody(latest.body, key_path))
          ) {
            finish(() =>
              reject(
                new NetworkNoMatchError(
                  'Matching responses returned different rows without a reliable request order. Start a fresh capture and save the request again.',
                ),
              ),
            );
          }
        } catch (e) {
          finish(() => reject(e instanceof Error ? e : new Error(String(e))));
        }
      }
      opts.onProgress?.(
        `Matched ${matchCount} request${matchCount === 1 ? '' : 's'}; checking for other matches until the capture window ends…`,
      );
      return { ack: true };
    };
    let windowTimer: ReturnType<typeof setTimeout> | undefined;
    const startWindow = () => {
      if (finished) return;
      windowTimer = setTimeout(() => {
        if (latest) {
          concludeWithMatches();
        } else {
          finish(() =>
            reject(
              new NetworkNoMatchError(
                `No successful request matching "${sanitizeNetworkUrl(url_filter, credential_query_keys)}" and the saved body identity was captured within ${formatDurationMs(windowMs, { style: 'long' })} of reloading. Run again and interact with the page (scroll or open the list) while it listens. Document-start interception was armed before reload; if the request needs an interaction, trigger it while capture listens.`,
              ),
            ),
          );
        }
      }, windowMs);
    };
    cleanup.push(() => {
      if (windowTimer !== undefined) clearTimeout(windowTimer);
    });

    const cancel = () => {
      captureAbort.abort();
      finish(() => reject(new NetworkNoMatchError('Network replay was cancelled.')));
    };
    opts.signal?.addEventListener('abort', cancel, { once: true });
    cleanup.push(() => opts.signal?.removeEventListener('abort', cancel));
    opts.onProgress?.('Preparing document-start capture before reloading…');
    capture = openDocumentNetworkCapture({
      tabId,
      captureId,
      maxBodyBytes: opts.maxBodyBytes ?? 1_000_000,
      timeoutMs: windowMs,
      signal: captureAbort.signal,
      onEvent: consumeEvent,
      onArmed: startWindow,
      ...(opts.expectedPage && { expectedPage: opts.expectedPage }),
      onFailure: (error) => finish(() => reject(new NetworkNoMatchError(error.message))),
    });
    void capture.then(
      () => {
        captureReady = true;
        if (!finished) opts.onProgress?.('Listening in the reloaded document…');
      },
      (error: unknown) =>
        finish(() =>
          reject(new NetworkNoMatchError(error instanceof Error ? error.message : String(error))),
        ),
    );
    if (opts.signal?.aborted) cancel();
  });
}

/**
 * THE entry point for running a saved pattern. DOM kinds run in a single
 * in-page pass; interactive kinds route to their orchestrated runners.
 */
export async function runSavedPattern(
  pattern: ExtractionPattern,
  tabId: number,
  opts: InteractiveRunOptions,
): Promise<ExtractedRow[]> {
  if (pattern.kind === 'ai_extract') return runAiExtractPattern(pattern.config, tabId, opts);
  if (pattern.kind === 'network_capture') {
    if (!opts.captureApproved) {
      const { openSavedPatternOperation } = await import('./document-network-transport');
      const result = (await openSavedPatternOperation(pattern.id, tabId, opts)) as {
        ok: boolean;
        rows?: ExtractedRow[];
        reason?: string;
        retryable?: boolean;
      };
      if (!result.ok) {
        if (result.retryable)
          throw new NetworkNoMatchError(result.reason ?? 'Replay did not match.');
        throw new Error(result.reason ?? 'Saved replay failed.');
      }
      return result.rows ?? [];
    }
    return runNetworkCapturePattern(pattern.config, tabId, opts);
  }
  return runPattern(pattern, tabId, opts.documentId);
}
