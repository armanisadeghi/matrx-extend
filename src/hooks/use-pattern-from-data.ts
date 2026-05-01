import { useActiveTab } from '@/hooks/use-active-tab';
import { type AgentStartRequest, agentExecutePath } from '@/lib/api/routes/ai';
import { newId } from '@/lib/id';
import { on, send } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';

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

export interface PatternFromDataResult {
  kind: 'list_pattern';
  config: {
    list_root: string;
    item_selector: string;
    field_paths: {
      name: string;
      rel_selector: string;
      attr?: string;
      transform?: { kind: 'regex'; expr: string };
    }[];
  };
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
  warnings?: string[];
}

interface ConvertInput {
  agentId: string;
  userInput: string;
  extractedRows: Record<string, unknown>[];
  pageMetadata?: Record<string, unknown>;
  listRootHint?: string;
}

/**
 * Captures up to 3 outerHTML samples from the active page using a
 * repeating-card heuristic. Falls back to a single <main>/<article>/<body>
 * snapshot if no obvious group is found. Caps each sample to ~3KB.
 */
function captureSampleHtmlInPage(): string[] {
  const STATEFUL_RE = /^(active|hover|focus|selected|open|expanded|hidden|loading)$/i;
  const AUTOGEN_RE = /^(?:_[\w-]{4,}|css-[a-z0-9]{4,}|jsx-\d+|sc-[a-zA-Z0-9]+)$/;
  const SKIP_TAGS = new Set([
    'html',
    'head',
    'meta',
    'link',
    'script',
    'style',
    'noscript',
    'br',
    'hr',
    'svg',
    'path',
  ]);
  const childFp = (el: Element): string | null => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return null;
    const classes = Array.from(el.classList)
      .filter((c) => !STATEFUL_RE.test(c) && !AUTOGEN_RE.test(c))
      .slice(0, 2);
    if (classes.length > 0) {
      return tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
    }
    if (tag === 'li' || tag === 'article' || tag === 'tr' || tag === 'section') return tag;
    return null;
  };
  const cap = (s: string): string => {
    if (s.length <= 3000) return s;
    return `${s.slice(0, 3000)}\n…(+${s.length - 3000} chars truncated)`;
  };

  // Find the largest repeating group.
  const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
  let bestParent: Element | null = null;
  let bestFp: string | null = null;
  let bestCount = 4;
  for (const parent of all) {
    if (parent.children.length < 5) continue;
    if (SKIP_TAGS.has(parent.tagName.toLowerCase())) continue;
    const buckets = new Map<string, Element[]>();
    for (const c of Array.from(parent.children)) {
      const fp = childFp(c);
      if (!fp) continue;
      const arr = buckets.get(fp) ?? [];
      arr.push(c);
      buckets.set(fp, arr);
    }
    for (const [fp, items] of buckets) {
      if (items.length > bestCount) {
        bestCount = items.length;
        bestParent = parent;
        bestFp = fp;
      }
    }
  }

  if (bestParent && bestFp) {
    const items = Array.from(bestParent.querySelectorAll(bestFp))
      .filter((n) => n.parentElement === bestParent)
      .slice(0, 3);
    return items.map((n) => cap((n as HTMLElement).outerHTML ?? ''));
  }

  // Fallback: a single main/article/body snapshot.
  const main = document.querySelector('main, article, [role="main"]') ?? document.body;
  return [cap((main as HTMLElement).outerHTML ?? '')];
}

/**
 * Drives the "Pattern from Extracted Data" agent: given AI-extracted rows
 * and a user description, returns a list_pattern config that can re-create
 * those rows via pure DOM extraction.
 *
 * Same channel infrastructure as useAiExtraction — accumulates streamed
 * text, parses JSON on `done`. Filters by its own runId so the two surfaces
 * don't collide.
 */
export function usePatternFromData() {
  const tab = useActiveTab();
  const [result, setResult] = useState<PatternFromDataResult | null>(null);
  const [rawResponse, setRawResponse] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const accumRef = useRef('');

  useEffect(() => {
    return on<StreamChunk, { ack: true }>(CHANNELS.STREAM_CHUNK, (chunk) => {
      if (chunk.runId !== runIdRef.current) return { ack: true };
      if (chunk.type === 'text' && chunk.payload.content) {
        accumRef.current += chunk.payload.content;
      } else if (chunk.type === 'error') {
        setError(chunk.payload.message ?? 'stream error');
        setRunning(false);
        runIdRef.current = null;
      } else if (chunk.type === 'done') {
        setRawResponse(accumRef.current);
        try {
          const parsed = parseAgentJson(accumRef.current) as PatternFromDataResult;
          if (!parsed?.config?.item_selector) {
            throw new Error('Agent response missing config.item_selector.');
          }
          setResult(parsed);
        } catch (e) {
          setError(`Could not parse agent response: ${e instanceof Error ? e.message : String(e)}`);
        }
        setRunning(false);
        runIdRef.current = null;
      }
      return { ack: true };
    });
  }, []);

  const convert = useCallback(
    async (input: ConvertInput): Promise<void> => {
      if (!tab.id) {
        setError('No active tab.');
        return;
      }
      if (!input.agentId) {
        setError('No agent selected.');
        return;
      }
      if (!input.extractedRows.length) {
        setError('No extracted rows to convert.');
        return;
      }

      setRunning(true);
      setError(null);
      setResult(null);
      setRawResponse('');
      accumRef.current = '';

      // Capture 1-3 sample HTML cards from the page.
      let sampleHtml: string[] = [];
      try {
        const r = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: captureSampleHtmlInPage,
        });
        sampleHtml = (r?.[0]?.result as string[] | undefined) ?? [];
      } catch (e) {
        setError(`Could not capture sample HTML: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
        return;
      }

      const runId = newId('pfd');
      runIdRef.current = runId;

      const body: AgentStartRequest = {
        user_input: input.userInput,
        conversation_id: null,
        variables: {
          page_url: tab.url ?? '',
          page_metadata: input.pageMetadata ?? {},
          list_root_hint: input.listRootHint ?? '',
          sample_html: sampleHtml,
          extracted_rows: input.extractedRows.slice(0, 3),
        },
        context: { page_title: tab.title ?? '' },
        stream: true,
        store: false,
        source_app: 'matrx-extend',
        source_feature: 'data-pattern-from-data',
        client_tools: [],
      };

      try {
        await send(CHANNELS.STREAM_START, {
          runId,
          endpoint: agentExecutePath(input.agentId),
          body,
          parser: 'rich-events' as const,
          agentName: null,
          permissionMode: 'auto',
        });
      } catch (e) {
        setError(`Failed to start agent: ${e instanceof Error ? e.message : String(e)}`);
        setRunning(false);
        runIdRef.current = null;
      }
    },
    [tab.id, tab.url, tab.title],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setRawResponse('');
  }, []);

  return { result, running, error, rawResponse, convert, reset };
}

/**
 * Parses the agent's streamed text into a JSON object. Tolerates code
 * fences, leading/trailing prose, and either a {...} or [...] outer shape.
 */
function parseAgentJson(raw: string): unknown {
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

  return JSON.parse(body);
}
