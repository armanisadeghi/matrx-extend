/**
 * Smart Tests — realistic, multi-step tool workflows.
 *
 * The Catalog tab tests one tool at a time with raw JSON args. That's
 * useful for schema validation, but it doesn't tell us much about how a
 * tool will perform in the wild — most tools are only useful when chained
 * with another (scrape → summarize, screenshot → describe, etc.).
 *
 * Each scenario:
 *   1. Captures / reads whatever input the tool actually needs in practice
 *   2. Calls the underlying onbox-ai wrapper directly (NOT through the tool
 *      handler) and passes an `onRequest` callback that fires synchronously
 *      with the LITERAL payload right before the native API call. We use
 *      this to display "what the model saw" the moment it's sent — no
 *      reconstruction, no drift, no waiting for the result.
 *   3. Times every step and shows the result inline.
 *
 * If you edit a system prompt in `onbox-ai.ts` or `client.ts`, your edit
 * shows up here automatically — the panel renders whatever the wrapper
 * actually emits, not a hand-built copy.
 */

import { CopyButton } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type OnboxRequestEvent,
  detectLanguage,
  proofread,
  quickPrompt,
  summarize,
  translate,
} from '@/lib/onbox-ai/client';
import {
  INJECTION_RESPONSE_SCHEMA,
  buildClassifySchema,
  buildClassifySystemPrompt,
  buildExtractSystemPrompt,
  buildInjectionSystemPrompt,
} from '@/lib/tools/handlers/onbox-ai';
import { get_page_selection, read_active_page } from '@/lib/tools/handlers/read';
import type { ToolContext, ToolHandler } from '@/lib/tools/types';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  Play,
  Timer,
} from 'lucide-react';
import { useMemo, useState } from 'react';

const TEST_CTX: ToolContext = {
  conversationId: null,
  runId: 'smart-test',
  callId: 'smart-test',
  agentName: 'manual',
  permissionMode: 'act',
  // No assignment in test mode — handlers fall back to the focused tab,
  // which is what the user is looking at when they hit Run.
  assignedTabId: null,
};

type Step = { label: string; ms: number; detail?: string | undefined };

type ScenarioState = {
  running: boolean;
  steps: Step[];
  result?: unknown;
  error?: string;
  /**
   * Literal payloads emitted by the onbox-ai wrappers, in firing order.
   * One entry per native API call; a fallback chain produces multiple.
   */
  modelInputs: OnboxRequestEvent[];
};

const initialState: ScenarioState = { running: false, steps: [], modelInputs: [] };

export function SmartTestsView() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <FlaskConical className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">Smart tool tests</span>
        <span className="text-[11px] text-muted-foreground">
          End-to-end scenarios that chain tools the way an agent would.
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-1.5">
          <SummarizePageScenario />
          <ClassifyPageScenario />
          <ExtractJsonPageScenario />
          <TranslateFirstParagraphScenario />
          <DetectLanguageScenario />
          <ProofreadSelectionScenario />
          <InjectionCheckScenario />
          <DescribeFirstImageScenario />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario shell — collapsible card with timing rail and result.
 * ──────────────────────────────────────────────────────────────────────── */

interface ScenarioCardProps {
  title: string;
  blurb: string;
  toolNames: string[];
  state: ScenarioState;
  controls?: React.ReactNode;
  onRun: () => void;
  renderResult?: (result: unknown) => React.ReactNode;
}

function ScenarioCard({
  title,
  blurb,
  toolNames,
  state,
  controls,
  onRun,
  renderResult,
}: ScenarioCardProps) {
  const [open, setOpen] = useState(false);
  const totalMs = state.steps.reduce((acc, s) => acc + s.ms, 0);

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium">{title}</span>
            {toolNames.map((n) => (
              <span
                key={n}
                className="rounded-sm bg-muted px-1 py-0 font-mono text-[9px] text-muted-foreground"
              >
                {n}
              </span>
            ))}
            {state.steps.length > 0 && !state.running && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
                <Timer className="size-3" />
                {fmtMs(totalMs)}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{blurb}</div>
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t px-2.5 py-2 text-[11px]">
          {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-6 gap-1" onClick={onRun} disabled={state.running}>
              {state.running ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              Run
            </Button>
            {state.running && <span className="text-[10px] text-muted-foreground">running…</span>}
          </div>

          {state.steps.length > 0 && (
            <div className="rounded-md bg-background/60 p-1.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                  timing
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  total {fmtMs(totalMs)}
                </span>
              </div>
              <div className="space-y-0.5">
                {state.steps.map((s, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[10px]">
                    <span className="w-24 shrink-0 truncate text-muted-foreground">{s.label}</span>
                    <span className="w-12 shrink-0 text-right tabular-nums">{fmtMs(s.ms)}</span>
                    <span className="flex-1 truncate font-mono text-muted-foreground/80">
                      {s.detail ?? ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.modelInputs.length > 0 && <ModelInputPanel events={state.modelInputs} />}

          {state.error && (
            <div className="flex items-start gap-1.5 rounded-md bg-red-50 p-1.5 text-[10px] text-red-800 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <pre className="whitespace-pre-wrap break-words">{state.error}</pre>
            </div>
          )}

          {state.result !== undefined && !state.error && renderResult && (
            <div>{renderResult(state.result)}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Model-input panel — renders the LITERAL OnboxRequestEvent(s) emitted by
 * the wrapper. No reconstruction. If a fallback fired, both events show
 * up in chronological order so you can see "Summarizer failed → fallback
 * to languageModel.prompt()" with the actual fallback prompt.
 * ──────────────────────────────────────────────────────────────────────── */

function ModelInputPanel({ events }: { events: OnboxRequestEvent[] }) {
  const [open, setOpen] = useState(true);

  const fullText = useMemo(() => events.map(eventToText).join('\n\n———\n\n'), [events]);

  return (
    <div className="rounded-md border border-dashed bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        {open ? (
          <ChevronDown className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground" />
        )}
        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          input the model saw
        </span>
        <span className="text-[10px] text-muted-foreground/80">
          {events.length} call{events.length === 1 ? '' : 's'}
        </span>
        <span
          className="ml-auto"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <CopyButton text={fullText} title="Copy full payload" size="xs" />
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-2 py-1.5">
          {events.map((evt, i) => (
            <ModelInputEvent key={i} index={i + 1} total={events.length} event={evt} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModelInputEvent({
  index,
  total,
  event,
}: {
  index: number;
  total: number;
  event: OnboxRequestEvent;
}) {
  const initialPrompts = (event.createOptions?.initialPrompts ?? null) as Array<{
    role: string;
    content: string;
  }> | null;
  const systemPrompt = initialPrompts?.find((p) => p.role === 'system')?.content;

  return (
    <div className="space-y-1.5 rounded border bg-card/60 p-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {total > 1 && <span className="rounded bg-muted px-1 tabular-nums">#{index}</span>}
        <span className="font-mono">{event.api}.create() → .prompt()</span>
        <span
          className={cn(
            'rounded px-1',
            event.via === 'native'
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
          )}
        >
          {event.via}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/70">task: {event.task}</span>
      </div>

      {event.createOptions && Object.keys(event.createOptions).length > 0 && (
        <ModelInputSection label="create() options">
          <pre className="rounded bg-muted/50 p-1.5 font-mono text-[10px] whitespace-pre-wrap break-words">
            {stringifyPayload(event.createOptions)}
          </pre>
        </ModelInputSection>
      )}

      {systemPrompt !== undefined && (
        <ModelInputSection label="system prompt (extracted from initialPrompts)">
          <pre className="rounded bg-muted/50 p-1.5 text-[10px] whitespace-pre-wrap break-words">
            {systemPrompt}
          </pre>
        </ModelInputSection>
      )}

      {event.promptOptions && Object.keys(event.promptOptions).length > 0 && (
        <ModelInputSection label="prompt() options">
          <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-1.5 font-mono text-[10px]">
            {stringifyPayload(event.promptOptions)}
          </pre>
        </ModelInputSection>
      )}

      <ModelInputSection
        label={`prompt() input${
          typeof event.promptInput === 'string'
            ? ` · ${event.promptInput.length.toLocaleString()} chars`
            : ''
        }`}
      >
        <pre className="max-h-60 overflow-auto rounded bg-muted/50 p-1.5 text-[10px] whitespace-pre-wrap break-words">
          {typeof event.promptInput === 'string'
            ? event.promptInput
            : stringifyPayload(event.promptInput)}
        </pre>
      </ModelInputSection>
    </div>
  );
}

function ModelInputSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      {children}
    </div>
  );
}

function eventToText(event: OnboxRequestEvent): string {
  const parts: string[] = [
    `# ${event.api}.${event.via === 'native' ? 'native' : 'fallback'} (task: ${event.task})`,
  ];
  if (event.createOptions && Object.keys(event.createOptions).length > 0) {
    parts.push(`\n## create() options\n${stringifyPayload(event.createOptions)}`);
  }
  if (event.promptOptions && Object.keys(event.promptOptions).length > 0) {
    parts.push(`\n## prompt() options\n${stringifyPayload(event.promptOptions)}`);
  }
  parts.push(
    `\n## prompt() input\n${
      typeof event.promptInput === 'string'
        ? event.promptInput
        : stringifyPayload(event.promptInput)
    }`,
  );
  return parts.join('\n');
}

/** JSON.stringify replacer that handles Blob (multimodal) gracefully. */
function stringifyPayload(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => {
      if (typeof Blob !== 'undefined' && v instanceof Blob) {
        return `[Blob ${v.type || 'unknown'} · ${v.size.toLocaleString()} bytes]`;
      }
      return v;
    },
    2,
  );
}

function ResultBlock({
  label,
  body,
}: {
  label: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <CopyButton text={body} title="Copy result" size="xs" />
      </div>
      <pre className="mt-0.5 max-h-60 overflow-auto rounded-md bg-background/60 p-1.5 text-[10px] leading-snug whitespace-pre-wrap">
        {body}
      </pre>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Shared helpers — capture-active-page, time-step, build a stateful
 * onRequest sink that updates scenario state synchronously.
 * ──────────────────────────────────────────────────────────────────────── */

interface CapturedPage {
  url: string;
  title: string | null;
  markdown: string;
  word_count: number | null;
  first_image_url: string | null;
}

async function capturePage(
  step: (label: string, ms: number, detail?: string) => void,
): Promise<CapturedPage> {
  const t0 = performance.now();
  const out = await runHandler(read_active_page, { deep: false });
  const ms = performance.now() - t0;
  const o = out as {
    ok?: boolean;
    reason?: string;
    url?: string;
    article?: { title: string | null; content_markdown: string | null; word_count: number | null };
    images?: { src: string }[];
  };
  if (o?.ok === false) {
    step('scrape', ms, o.reason ?? 'failed');
    throw new Error(o.reason ?? 'read_active_page failed');
  }
  const md = o.article?.content_markdown ?? '';
  step('scrape', ms, `${md.length.toLocaleString()} chars · ${o.article?.word_count ?? '—'} words`);
  return {
    url: o.url ?? '',
    title: o.article?.title ?? null,
    markdown: md,
    word_count: o.article?.word_count ?? null,
    first_image_url: o.images?.[0]?.src ?? null,
  };
}

async function runHandler<TArgs, TResult>(
  handler: ToolHandler<TArgs, TResult>,
  args: TArgs,
): Promise<TResult> {
  return handler.run(args, TEST_CTX);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Per-scenario hook — owns state, exposes a runner builder that wires up
 * the synchronous onRequest sink so model inputs land in the panel the
 * instant the wrapper fires them.
 */
function useScenarioRunner() {
  const [state, setState] = useState<ScenarioState>(initialState);

  const begin = () => {
    setState({ running: true, steps: [], modelInputs: [] });
    const steps: Step[] = [];
    const events: OnboxRequestEvent[] = [];
    const pushStep = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    const onRequest = (evt: OnboxRequestEvent) => {
      events.push(evt);
      setState((s) => ({ ...s, modelInputs: [...events] }));
    };
    const finish = (patch: Partial<ScenarioState>) => {
      setState((s) => ({
        ...s,
        ...patch,
        running: false,
        steps: [...steps],
        modelInputs: [...events],
      }));
    };
    return { pushStep, onRequest, finish };
  };

  return { state, begin };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: AI summarize active page
 * ──────────────────────────────────────────────────────────────────────── */

const CHAR_CAPS: Array<{ value: number; label: string }> = [
  { value: 1000, label: '1k' },
  { value: 2500, label: '2.5k' },
  { value: 5000, label: '5k' },
  { value: 10000, label: '10k' },
  { value: 20000, label: '20k' },
  { value: 0, label: 'no cap' },
];

function SummarizePageScenario() {
  const { state, begin } = useScenarioRunner();
  const [cap, setCap] = useState(5000);
  const [type, setType] = useState<'tldr' | 'key-points' | 'teaser' | 'headline'>('tldr');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('short');

  const run = async () => {
    const { pushStep, onRequest, finish } = begin();
    try {
      const page = await capturePage(pushStep);
      const sliced = cap > 0 ? page.markdown.slice(0, cap) : page.markdown;
      pushStep('truncate', 0, `${sliced.length.toLocaleString()} chars sent to model`);
      const t0 = performance.now();
      const out = await summarize(sliced, { type, length, onRequest });
      pushStep('summarize', performance.now() - t0, `${type} · ${length}`);
      finish({ result: out });
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Summarize active page"
      blurb="Scrape the page, slice the article markdown, hand it to the Summarizer API. Tune the cap to find the latency / quality sweet spot."
      toolNames={['read_active_page', 'ai_summarize']}
      state={state}
      onRun={run}
      controls={
        <>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">cap</span>
            <Select value={String(cap)} onValueChange={(v) => setCap(Number(v))}>
              <SelectTrigger className="h-6 min-w-24 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAR_CAPS.map((c) => (
                  <SelectItem key={c.value} value={String(c.value)}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">type</span>
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger className="h-6 min-w-32 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tldr">tldr</SelectItem>
                <SelectItem value="key-points">key-points</SelectItem>
                <SelectItem value="teaser">teaser</SelectItem>
                <SelectItem value="headline">headline</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">length</span>
            <Select value={length} onValueChange={(v) => setLength(v as typeof length)}>
              <SelectTrigger className="h-6 min-w-24 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short">short</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="long">long</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      }
      renderResult={(r) => {
        const o = r as { ok?: boolean; data?: string; reason?: string; availability?: string };
        if (!o?.ok) {
          return (
            <ResultBlock
              label="failed"
              body={`${o?.reason ?? 'unknown'}${o?.availability ? ` · availability: ${o.availability}` : ''}`}
            />
          );
        }
        return <ResultBlock label="summary" body={o.data ?? ''} />;
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: classify active page into a content type
 * ──────────────────────────────────────────────────────────────────────── */

function ClassifyPageScenario() {
  const { state, begin } = useScenarioRunner();
  const [labelsText, setLabelsText] = useState(
    'article, landing page, product page, documentation, forum thread, video, search results, app dashboard',
  );

  const run = async () => {
    const { pushStep, onRequest, finish } = begin();
    try {
      const labels = labelsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (labels.length < 2) throw new Error('Need at least 2 comma-separated labels.');
      const page = await capturePage(pushStep);
      const sliced = page.markdown.slice(0, 3000);
      pushStep('truncate', 0, `${sliced.length.toLocaleString()} chars`);
      const t0 = performance.now();
      const r = await quickPrompt(sliced, {
        systemPrompt: buildClassifySystemPrompt(labels),
        responseConstraint: buildClassifySchema(labels),
        onRequest,
        requestTask: 'ai_classify',
      });
      pushStep('classify', performance.now() - t0, `${labels.length} labels`);
      if (!r.ok || !r.data) {
        finish({ result: { ok: false, reason: r.reason, availability: r.availability } });
        return;
      }
      try {
        const parsed = JSON.parse(r.data) as { label: string; confidence?: number };
        finish({
          result: { ok: true, label: parsed.label, confidence: parsed.confidence ?? null },
        });
      } catch (err) {
        finish({
          result: {
            ok: false,
            reason: `JSON parse failed: ${(err as Error).message}`,
            raw: r.data,
          },
        });
      }
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Classify active page"
      blurb="Scrape the page, send the first 3k chars to languageModel.prompt() with a label-constrained schema."
      toolNames={['read_active_page', 'ai_classify']}
      state={state}
      onRun={run}
      controls={
        <Input
          value={labelsText}
          onChange={(e) => setLabelsText(e.target.value)}
          placeholder="comma-separated labels"
          className="h-6 flex-1 text-[11px]"
        />
      }
      renderResult={(r) => {
        const o = r as {
          ok?: boolean;
          label?: string;
          confidence?: number | null;
          reason?: string;
          raw?: string;
        };
        if (!o?.ok)
          return (
            <ResultBlock
              label="failed"
              body={`${o?.reason ?? 'unknown'}${o?.raw ? `\n\n--- raw ---\n${o.raw}` : ''}`}
            />
          );
        return (
          <ResultBlock
            label="result"
            body={`label: ${o.label}\nconfidence: ${o.confidence ?? '—'}`}
          />
        );
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: extract structured JSON from active page
 * ──────────────────────────────────────────────────────────────────────── */

const DEFAULT_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    author: { type: 'string' },
    primary_topic: { type: 'string' },
    summary: { type: 'string' },
    is_paywalled: { type: 'boolean' },
  },
  required: ['title', 'primary_topic', 'summary'],
};

function ExtractJsonPageScenario() {
  const { state, begin } = useScenarioRunner();
  const [schemaText, setSchemaText] = useState(JSON.stringify(DEFAULT_EXTRACT_SCHEMA, null, 2));

  const run = async () => {
    const { pushStep, onRequest, finish } = begin();
    try {
      let schema: unknown;
      try {
        schema = JSON.parse(schemaText);
      } catch (err) {
        throw new Error(`Schema is not valid JSON: ${(err as Error).message}`);
      }
      const page = await capturePage(pushStep);
      const sliced = page.markdown.slice(0, 5000);
      pushStep('truncate', 0, `${sliced.length.toLocaleString()} chars`);
      const t0 = performance.now();
      const r = await quickPrompt(sliced, {
        systemPrompt: buildExtractSystemPrompt(),
        responseConstraint: schema,
        onRequest,
        requestTask: 'ai_extract_json',
      });
      pushStep('extract', performance.now() - t0);
      if (!r.ok || !r.data) {
        finish({ result: { ok: false, reason: r.reason } });
        return;
      }
      try {
        finish({ result: { ok: true, data: JSON.parse(r.data) } });
      } catch (err) {
        finish({
          result: {
            ok: false,
            reason: `JSON parse failed: ${(err as Error).message}`,
            raw: r.data,
          },
        });
      }
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Extract JSON from active page"
      blurb="Scrape the page, take the first 5k chars, ask languageModel.prompt() to fill out a schema."
      toolNames={['read_active_page', 'ai_extract_json']}
      state={state}
      onRun={run}
      controls={
        <textarea
          value={schemaText}
          onChange={(e) => setSchemaText(e.target.value)}
          rows={6}
          className="w-full rounded-md border bg-background p-1.5 font-mono text-[10px] focus:outline-none focus:ring-2 focus:ring-ring"
        />
      }
      renderResult={(r) => {
        const o = r as { ok?: boolean; data?: unknown; reason?: string; raw?: string };
        if (!o?.ok)
          return (
            <ResultBlock
              label="failed"
              body={`${o?.reason ?? 'unknown'}${o?.raw ? `\n\n--- raw ---\n${o.raw}` : ''}`}
            />
          );
        return <ResultBlock label="data" body={JSON.stringify(o.data, null, 2)} />;
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: translate the first paragraph
 * ──────────────────────────────────────────────────────────────────────── */

function TranslateFirstParagraphScenario() {
  const { state, begin } = useScenarioRunner();
  const [target, setTarget] = useState('es');

  const run = async () => {
    const { pushStep, onRequest, finish } = begin();
    try {
      const page = await capturePage(pushStep);
      const para =
        page.markdown
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .find((p) => p.length > 80 && !p.startsWith('#') && !p.startsWith('!'))
          ?.slice(0, 1500) ?? page.markdown.slice(0, 800);
      pushStep('extract paragraph', 0, `${para.length} chars`);
      // First detect source language so the wrapper has it cached. The
      // detector also fires its own onRequest event so the user sees both
      // calls (detect + translate) in the input panel.
      const tDetect = performance.now();
      const det = await detectLanguage(para, { onRequest });
      pushStep('detect-source', performance.now() - tDetect);
      let src = 'en';
      if (det.ok && det.data && det.data.length > 0) {
        const first = det.data[0];
        src =
          typeof first === 'string'
            ? first
            : ((first as unknown as { detectedLanguage?: string })?.detectedLanguage ?? 'en');
      }
      const t0 = performance.now();
      const out = await translate(para, src, target, { onRequest });
      pushStep('translate', performance.now() - t0, `${src} → ${target}`);
      finish({ result: { input: para, output: out, source: src } });
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Translate first paragraph"
      blurb="Scrape the page, find the first real paragraph, detect its language, then translate. You'll see TWO model-input events: detector + translator."
      toolNames={['read_active_page', 'ai_detect_language', 'ai_translate']}
      state={state}
      onRun={run}
      controls={
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">target</span>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-6 min-w-36 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="es">Spanish (es)</SelectItem>
              <SelectItem value="fr">French (fr)</SelectItem>
              <SelectItem value="de">German (de)</SelectItem>
              <SelectItem value="ja">Japanese (ja)</SelectItem>
              <SelectItem value="zh">Chinese (zh)</SelectItem>
              <SelectItem value="ar">Arabic (ar)</SelectItem>
              <SelectItem value="en">English (en)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
      renderResult={(r) => {
        const o = r as {
          input: string;
          source: string;
          output: { ok?: boolean; data?: string; reason?: string };
        };
        if (!o.output?.ok)
          return <ResultBlock label="failed" body={o.output?.reason ?? 'unknown'} />;
        return (
          <ResultBlock
            label={`translation (${o.source} → ${target})`}
            body={`--- input ---\n${o.input}\n\n--- output ---\n${o.output.data ?? ''}`}
          />
        );
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: detect page language
 * ──────────────────────────────────────────────────────────────────────── */

function DetectLanguageScenario() {
  const { state, begin } = useScenarioRunner();

  const run = async () => {
    const { pushStep, onRequest, finish } = begin();
    try {
      const page = await capturePage(pushStep);
      const sliced = page.markdown.slice(0, 1500);
      pushStep('truncate', 0, `${sliced.length.toLocaleString()} chars`);
      const t0 = performance.now();
      const out = await detectLanguage(sliced, { onRequest });
      pushStep('detect', performance.now() - t0);
      finish({ result: out });
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Detect page language"
      blurb="Scrape the page, send first 1.5k chars to the LanguageDetector API."
      toolNames={['read_active_page', 'ai_detect_language']}
      state={state}
      onRun={run}
      renderResult={(r) => {
        const o = r as { ok?: boolean; data?: unknown; reason?: string };
        if (!o?.ok) return <ResultBlock label="failed" body={o?.reason ?? 'unknown'} />;
        return <ResultBlock label="candidates" body={JSON.stringify(o.data, null, 2)} />;
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: proofread current selection
 * ──────────────────────────────────────────────────────────────────────── */

function ProofreadSelectionScenario() {
  const { state, begin } = useScenarioRunner();

  const run = async () => {
    const { pushStep, onRequest, finish } = begin();
    try {
      const tSel = performance.now();
      const sel = (await runHandler(get_page_selection, {})) as {
        text: string;
        selected: boolean;
      };
      pushStep('get selection', performance.now() - tSel, `${sel.text.length} chars`);
      if (!sel.selected || !sel.text.trim()) {
        throw new Error('Nothing is selected on the active page. Highlight some text and retry.');
      }
      const t0 = performance.now();
      const out = await proofread(sel.text, { onRequest });
      pushStep('proofread', performance.now() - t0);
      finish({ result: { input: sel.text, output: out } });
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Proofread selection"
      blurb="Read whatever the user has highlighted on the active page, send to the Proofreader API."
      toolNames={['get_page_selection', 'ai_proofread']}
      state={state}
      onRun={run}
      renderResult={(r) => {
        const o = r as {
          input: string;
          output: {
            ok?: boolean;
            data?: { correctedInput: string; corrections?: unknown };
            reason?: string;
          };
        };
        if (!o.output?.ok)
          return <ResultBlock label="failed" body={o.output?.reason ?? 'unknown'} />;
        return (
          <ResultBlock
            label="proofread"
            body={`--- input ---\n${o.input}\n\n--- output ---\n${JSON.stringify(o.output.data, null, 2)}`}
          />
        );
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: prompt-injection guardrail on active page
 * ──────────────────────────────────────────────────────────────────────── */

function InjectionCheckScenario() {
  const { state, begin } = useScenarioRunner();

  const run = async () => {
    const { pushStep, onRequest, finish } = begin();
    try {
      const page = await capturePage(pushStep);
      const sliced = page.markdown.slice(0, 6000);
      pushStep('truncate', 0, `${sliced.length.toLocaleString()} chars`);
      const t0 = performance.now();
      const r = await quickPrompt(sliced, {
        systemPrompt: buildInjectionSystemPrompt(page.url),
        responseConstraint: INJECTION_RESPONSE_SCHEMA,
        onRequest,
        requestTask: 'ai_check_prompt_injection',
      });
      pushStep('inject-check', performance.now() - t0);
      if (!r.ok || !r.data) {
        finish({ result: { ok: false, reason: r.reason } });
        return;
      }
      try {
        finish({ result: { ok: true, ...JSON.parse(r.data) } });
      } catch (err) {
        finish({
          result: {
            ok: false,
            reason: `JSON parse failed: ${(err as Error).message}`,
            raw: r.data,
          },
        });
      }
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Prompt-injection scan"
      blurb="Scrape the page, run the first 6k chars through languageModel.prompt() with a security-analyst system prompt."
      toolNames={['read_active_page', 'ai_check_prompt_injection']}
      state={state}
      onRun={run}
      renderResult={(r) => {
        const o = r as Record<string, unknown> & { ok?: boolean };
        if (!o?.ok) return <ResultBlock label="failed" body={JSON.stringify(o, null, 2)} />;
        return <ResultBlock label="verdict" body={JSON.stringify(o, null, 2)} />;
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: describe first image on the page
 * ──────────────────────────────────────────────────────────────────────── */

async function fetchImageAsBlob(
  url: string,
): Promise<{ blob: Blob; mime: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status} ${resp.statusText}`);
  const blob = await resp.blob();
  let mime: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png';
  if (blob.type === 'image/jpeg') mime = 'image/jpeg';
  else if (blob.type === 'image/webp') mime = 'image/webp';
  else if (blob.type === 'image/png') mime = 'image/png';
  else throw new Error(`Unsupported image MIME: ${blob.type || 'unknown'}`);
  return { blob, mime, bytes: blob.size };
}

function DescribeFirstImageScenario() {
  const { state, begin } = useScenarioRunner();
  const [question, setQuestion] = useState('Describe this image in detail.');

  const run = async () => {
    const { pushStep, onRequest, finish } = begin();
    try {
      const page = await capturePage(pushStep);
      if (!page.first_image_url) throw new Error('No images found on the active page.');
      const tFetch = performance.now();
      const { blob, mime, bytes } = await fetchImageAsBlob(page.first_image_url);
      pushStep(
        'fetch image',
        performance.now() - tFetch,
        `${(bytes / 1024).toFixed(0)} KB · ${mime}`,
      );
      const t0 = performance.now();
      const out = await quickPrompt(
        [
          {
            role: 'user',
            content: [
              { type: 'text', value: question },
              { type: 'image', value: blob },
            ],
          },
        ],
        {
          expectedInputs: [{ type: 'text' }, { type: 'image' }],
          onRequest,
          requestTask: 'ai_describe_image',
        },
      );
      pushStep('describe', performance.now() - t0);
      finish({ result: { url: page.first_image_url, output: out } });
    } catch (err) {
      finish({ error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Describe first image"
      blurb="Scrape the page, fetch the first image URL, send it as a multimodal prompt. The Blob shows up as [Blob image/png · X bytes] in the input panel."
      toolNames={['read_active_page', 'fetch', 'ai_describe_image']}
      state={state}
      onRun={run}
      controls={
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="h-6 flex-1 text-[11px]"
          placeholder="question for the model"
        />
      }
      renderResult={(r) => {
        const o = r as {
          url: string;
          output: { ok?: boolean; data?: string; reason?: string };
        };
        return (
          <div className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground">
              <span className="font-mono">{o.url}</span>
            </div>
            <img
              src={o.url}
              alt=""
              className={cn('max-h-32 rounded-md border bg-muted object-contain')}
            />
            {o.output?.ok ? (
              <ResultBlock label="description" body={o.output.data ?? ''} />
            ) : (
              <ResultBlock label="failed" body={o.output?.reason ?? 'unknown'} />
            )}
          </div>
        );
      }}
    />
  );
}
