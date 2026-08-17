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

import { type AgentStartRequest, agentExecutePath } from '@/lib/api/routes/ai';
import { resolveConversationOrganizationId } from '@/lib/api/routes/auth';
import { newId } from '@/lib/id';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { ExtractionPattern } from '@/lib/supabase/queries';
import { aiExtractCapturePage } from './modes/ai-extract';
import { type CapturedNetEvent, networkRelayIsolated, networkTapMain } from './network-tap';
import { runPattern } from './run-pattern';
import type { ExtractedRow } from './types';

export interface InteractiveRunOptions {
  /** Live progress notes for the UI ("Reloading page…", "Listening…"). */
  onProgress?: (note: string) => void;
  /** Hard cap for the whole interactive run. */
  timeoutMs?: number;
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
  description?: string;
  output_schema?: unknown;
}

export async function runAiExtractPattern(
  config: unknown,
  tabId: number,
  opts: InteractiveRunOptions = {},
): Promise<ExtractedRow[]> {
  const { agent_id, description, output_schema } = (config ?? {}) as SavedAiConfig;
  if (!agent_id || !description) {
    throw new Error('This AI pattern is missing its agent or description — re-save it.');
  }

  opts.onProgress?.('Reading page…');
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: aiExtractCapturePage,
  });
  const captured = result?.[0]?.result as ReturnType<typeof aiExtractCapturePage> | undefined;
  if (!captured) throw new Error('Page capture returned nothing.');

  const runId = newId('extract');
  const organizationId = await resolveConversationOrganizationId();
  const body: AgentStartRequest = {
    organization_id: organizationId,
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
    },
    context: { page_title: captured.title },
    stream: true,
    store: false,
    source_app: 'matrx-extend',
    source_feature: 'data-ai-extract-rerun',
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
      endpoint: agentExecutePath(agent_id),
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
  url_filter?: string;
  method?: string;
  key_path?: string;
}

/**
 * url_filter matching: globs (with *) when present, substring otherwise.
 * Saved filters look like "api.site.com/v1/items/*" (urlPattern output) or
 * free text the user typed into the filter box.
 */
export function matchesUrlFilter(url: string, filter: string): boolean {
  const f = filter.trim();
  if (!f) return true;
  if (!f.includes('*')) return url.includes(f);
  const re = new RegExp(
    f
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*'),
  );
  return re.test(url);
}

/** Walk a dotted key path (numeric segments index arrays) and shape rows. */
export function rowsFromBody(body: string, keyPath?: string): ExtractedRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('The captured response body is not JSON.');
  }
  let target: unknown = parsed;
  if (keyPath) {
    for (const part of keyPath.split('.')) {
      if (!part) continue;
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
    keyPath
      ? `Nothing found at key path "${keyPath}" in the captured response.`
      : 'The captured response was not an object or array.',
  );
}

/**
 * Thrown when the re-capture window closed with zero matching requests.
 * This is circumstantial (the page may simply not have fired that API on
 * reload) — callers should NOT mark the pattern broken for it.
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
  opts: InteractiveRunOptions = {},
): Promise<ExtractedRow[]> {
  const { url_filter, method, key_path } = (config ?? {}) as SavedNetConfig;
  if (!url_filter) {
    throw new Error('This network pattern has no url_filter — re-save it from the Network tab.');
  }
  const windowMs = opts.timeoutMs ?? 20_000;
  /** After the first match, keep listening briefly for a better (larger) one. */
  const settleMs = 2_000;

  return new Promise<ExtractedRow[]>((resolve, reject) => {
    const matches: CapturedNetEvent[] = [];
    let finished = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup: Array<() => void> = [];
    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      for (const c of cleanup) c();
      fn();
    };

    const concludeWithMatches = () => {
      finish(() => {
        // Prefer the largest body — list endpoints carry the most data.
        const best = matches.reduce((a, b) => (b.body_size > a.body_size ? b : a));
        try {
          resolve(rowsFromBody(best.body, key_path));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    };

    const offEvents = on<CapturedNetEvent, { ack: true }>(CHANNELS.NET_CAPTURE_EVENT, (event) => {
      if (finished) return { ack: true };
      if (event.tab_id !== tabId) return { ack: true };
      if (!matchesUrlFilter(event.url, url_filter)) return { ack: true };
      if (method && event.method.toUpperCase() !== method.toUpperCase()) return { ack: true };
      if (!event.body) return { ack: true };
      matches.push(event);
      opts.onProgress?.(`Matched ${matches.length} request${matches.length === 1 ? '' : 's'}…`);
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(concludeWithMatches, settleMs);
      return { ack: true };
    });
    cleanup.push(offEvents, () => {
      if (settleTimer) clearTimeout(settleTimer);
    });

    // Install the taps the moment the reloaded document starts — waiting for
    // load-complete would miss the data requests fired during hydration.
    const onUpdated = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || info.status !== 'loading') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      void (async () => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            injectImmediately: true,
            func: networkTapMain,
            args: [1_000_000],
          });
          await chrome.scripting.executeScript({
            target: { tabId },
            injectImmediately: true,
            func: networkRelayIsolated,
          });
          opts.onProgress?.('Listening for matching requests…');
        } catch (e) {
          finish(() => reject(e instanceof Error ? e : new Error(String(e))));
        }
      })();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    cleanup.push(() => chrome.tabs.onUpdated.removeListener(onUpdated));

    const windowTimer = setTimeout(() => {
      if (matches.length > 0) {
        concludeWithMatches();
      } else {
        finish(() =>
          reject(
            new NetworkNoMatchError(
              `No request matching "${url_filter}" fired within ${Math.round(windowMs / 1000)}s of reloading. Interact with the page (scroll, open the list) and run again — the listener installs on reload.`,
            ),
          ),
        );
      }
    }, windowMs);
    cleanup.push(() => clearTimeout(windowTimer));

    opts.onProgress?.('Reloading page…');
    void chrome.tabs
      .reload(tabId)
      .catch((e) => finish(() => reject(e instanceof Error ? e : new Error(String(e)))));
  });
}

/**
 * THE entry point for running a saved pattern. DOM kinds run in a single
 * in-page pass; interactive kinds route to their orchestrated runners.
 */
export async function runSavedPattern(
  pattern: ExtractionPattern,
  tabId: number,
  opts: InteractiveRunOptions = {},
): Promise<ExtractedRow[]> {
  if (pattern.kind === 'ai_extract') return runAiExtractPattern(pattern.config, tabId, opts);
  if (pattern.kind === 'network_capture') {
    return runNetworkCapturePattern(pattern.config, tabId, opts);
  }
  return runPattern(pattern, tabId);
}
