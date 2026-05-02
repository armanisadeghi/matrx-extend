/**
 * Smart Tests — realistic, multi-step tool workflows.
 *
 * The Catalog tab tests one tool at a time with raw JSON args. That's
 * useful for schema validation, but it doesn't tell us much about how a
 * tool will perform in the wild — most tools are only useful when chained
 * with another (scrape → summarize, screenshot → describe, etc.).
 *
 * Each scenario here simulates the realistic agent flow end-to-end:
 *   1. Capture / read whatever input the tool actually needs in practice
 *   2. Pass it to the tool
 *   3. Time every step and show the result
 *
 * Use this to decide whether a tool is fast enough to be useful, whether
 * its inputs need capping, or whether we should build a higher-level
 * "compound" tool that does the chain in one call.
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
  ai_check_prompt_injection,
  ai_classify,
  ai_describe_image,
  ai_detect_language,
  ai_extract_json,
  ai_proofread,
  ai_summarize,
  ai_translate,
  buildClassifySchema,
  buildClassifySystemPrompt,
  buildExtractSystemPrompt,
  buildInjectionSystemPrompt,
  INJECTION_RESPONSE_SCHEMA,
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
};

type Step = { label: string; ms: number; detail?: string };

/**
 * What the model actually saw. Reconstructed from the same builders the
 * handlers use, so this never drifts from the real call.
 */
interface ModelInput {
  toolName: string;
  /** Free-form summary of args (type, length, target language, etc.). */
  config?: Record<string, unknown>;
  /** The system / instruction prompt, when the tool builds one. */
  systemPrompt?: string;
  /** JSON Schema constraint applied to the response, when applicable. */
  responseConstraint?: unknown;
  /** The actual content sent as the user message (text or "[image: …]"). */
  userInput?: string;
  /** Notes that are useful but not part of the literal payload. */
  notes?: string[];
}

type ScenarioState = {
  running: boolean;
  steps: Step[];
  result?: unknown;
  error?: string;
  modelInput?: ModelInput;
};

const initialState: ScenarioState = { running: false, steps: [] };

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
  /** Render the "what's the result" section however we want per scenario. */
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
            {state.running && (
              <span className="text-[10px] text-muted-foreground">running…</span>
            )}
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

          {state.modelInput && <ModelInputPanel input={state.modelInput} />}

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

/**
 * Collapsible "what we actually sent the model" panel. Built from the same
 * exported helpers the handlers use, so what you see here IS what hits the
 * Prompt API. When the underlying API doesn't accept a system prompt (e.g.
 * the native Summarizer or Translator), we surface the config/options that
 * went in instead.
 */
function ModelInputPanel({ input }: { input: ModelInput }) {
  const [open, setOpen] = useState(false);

  const fullText = useMemo(() => modelInputToText(input), [input]);

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
        <span className="font-mono text-[10px] text-muted-foreground/80">{input.toolName}</span>
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
          <CopyButton text={fullText} title="Copy full prompt" size="xs" />
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t px-2 py-1.5">
          {input.config && Object.keys(input.config).length > 0 && (
            <ModelInputSection label="config">
              <pre className="rounded bg-muted/50 p-1.5 font-mono text-[10px]">
                {JSON.stringify(input.config, null, 2)}
              </pre>
            </ModelInputSection>
          )}
          {input.systemPrompt && (
            <ModelInputSection label="system prompt">
              <pre className="rounded bg-muted/50 p-1.5 text-[10px] whitespace-pre-wrap break-words">
                {input.systemPrompt}
              </pre>
            </ModelInputSection>
          )}
          {input.responseConstraint !== undefined && (
            <ModelInputSection label="response constraint (JSON Schema)">
              <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-1.5 font-mono text-[10px]">
                {JSON.stringify(input.responseConstraint, null, 2)}
              </pre>
            </ModelInputSection>
          )}
          {input.userInput !== undefined && (
            <ModelInputSection
              label={`user input (${input.userInput.length.toLocaleString()} chars)`}
            >
              <pre className="max-h-60 overflow-auto rounded bg-muted/50 p-1.5 text-[10px] whitespace-pre-wrap break-words">
                {input.userInput}
              </pre>
            </ModelInputSection>
          )}
          {input.notes && input.notes.length > 0 && (
            <ModelInputSection label="notes">
              <ul className="list-disc pl-4 text-[10px] text-muted-foreground">
                {input.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </ModelInputSection>
          )}
        </div>
      )}
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

function modelInputToText(input: ModelInput): string {
  const parts: string[] = [`# tool: ${input.toolName}`];
  if (input.config && Object.keys(input.config).length > 0) {
    parts.push(`\n## config\n${JSON.stringify(input.config, null, 2)}`);
  }
  if (input.systemPrompt) parts.push(`\n## system prompt\n${input.systemPrompt}`);
  if (input.responseConstraint !== undefined) {
    parts.push(`\n## response constraint\n${JSON.stringify(input.responseConstraint, null, 2)}`);
  }
  if (input.userInput !== undefined) parts.push(`\n## user input\n${input.userInput}`);
  if (input.notes?.length) parts.push(`\n## notes\n${input.notes.map((n) => `- ${n}`).join('\n')}`);
  return parts.join('\n');
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
 * Shared helpers — capture-active-page, time-step.
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
  const [state, setState] = useState<ScenarioState>(initialState);
  const [cap, setCap] = useState(5000);
  const [type, setType] = useState<'tldr' | 'key-points' | 'teaser' | 'headline'>('tldr');
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('short');

  const run = async () => {
    setState({ running: true, steps: [] });
    const steps: Step[] = [];
    const push = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    try {
      const page = await capturePage(push);
      const sliced = cap > 0 ? page.markdown.slice(0, cap) : page.markdown;
      push('truncate', 0, `${sliced.length.toLocaleString()} chars sent to model`);
      const modelInput: ModelInput = {
        toolName: 'ai_summarize → Summarizer API',
        config: { type, length, sharedContext: '(none)' },
        userInput: sliced,
        notes: [
          'The native Summarizer API does not accept a free-form system prompt — only the type/length config above.',
          'When the API is unavailable, the wrapper falls back to languageModel.prompt() with system prompt: "Summarize the following <type> in <length> length. Return only the summary."',
        ],
      };
      const t0 = performance.now();
      const out = await runHandler(ai_summarize, { text: sliced, type, length });
      push('summarize', performance.now() - t0, `${type} · ${length}`);
      setState({ running: false, steps, result: out, modelInput });
    } catch (err) {
      setState({ running: false, steps, error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Summarize active page"
      blurb="Scrape the page, slice the article markdown, hand it to ai_summarize. Tune the cap to find the latency / quality sweet spot."
      toolNames={['read_active_page', 'ai_summarize']}
      state={state}
      onRun={run}
      controls={
        <>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">cap</span>
            <Select value={String(cap)} onValueChange={(v) => setCap(Number(v))}>
              <SelectTrigger className="h-6 w-20 text-[11px]">
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
              <SelectTrigger className="h-6 w-24 text-[11px]">
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
              <SelectTrigger className="h-6 w-20 text-[11px]">
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
        const o = r as { ok?: boolean; summary?: string; reason?: string; availability?: string };
        if (!o?.ok) {
          return (
            <ResultBlock
              label="failed"
              body={`${o?.reason ?? 'unknown'}${o?.availability ? ` · availability: ${o.availability}` : ''}`}
            />
          );
        }
        return <ResultBlock label="summary" body={o.summary ?? ''} />;
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: classify active page into a content type
 * ──────────────────────────────────────────────────────────────────────── */

function ClassifyPageScenario() {
  const [state, setState] = useState<ScenarioState>(initialState);
  const [labelsText, setLabelsText] = useState(
    'article, landing page, product page, documentation, forum thread, video, search results, app dashboard',
  );

  const run = async () => {
    setState({ running: true, steps: [] });
    const steps: Step[] = [];
    const push = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    try {
      const labels = labelsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (labels.length < 2) throw new Error('Need at least 2 comma-separated labels.');
      const page = await capturePage(push);
      const sliced = page.markdown.slice(0, 3000);
      push('truncate', 0, `${sliced.length.toLocaleString()} chars`);
      const modelInput: ModelInput = {
        toolName: 'ai_classify → languageModel.prompt()',
        systemPrompt: buildClassifySystemPrompt(labels),
        responseConstraint: buildClassifySchema(labels),
        userInput: sliced,
      };
      const t0 = performance.now();
      const out = await runHandler(ai_classify, { text: sliced, labels });
      push('classify', performance.now() - t0, `${labels.length} labels`);
      setState({ running: false, steps, result: out, modelInput });
    } catch (err) {
      setState({ running: false, steps, error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Classify active page"
      blurb="Scrape the page, send the first 3k chars to ai_classify with a custom label set."
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
        const o = r as { ok?: boolean; label?: string; confidence?: number | null; reason?: string };
        if (!o?.ok) return <ResultBlock label="failed" body={o?.reason ?? 'unknown'} />;
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
  const [state, setState] = useState<ScenarioState>(initialState);
  const [schemaText, setSchemaText] = useState(JSON.stringify(DEFAULT_EXTRACT_SCHEMA, null, 2));

  const run = async () => {
    setState({ running: true, steps: [] });
    const steps: Step[] = [];
    const push = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    try {
      let schema: unknown;
      try {
        schema = JSON.parse(schemaText);
      } catch (err) {
        throw new Error(`Schema is not valid JSON: ${(err as Error).message}`);
      }
      const page = await capturePage(push);
      const sliced = page.markdown.slice(0, 5000);
      push('truncate', 0, `${sliced.length.toLocaleString()} chars`);
      const modelInput: ModelInput = {
        toolName: 'ai_extract_json → languageModel.prompt()',
        systemPrompt: buildExtractSystemPrompt(),
        responseConstraint: schema,
        userInput: sliced,
      };
      const t0 = performance.now();
      const out = await runHandler(ai_extract_json, { text: sliced, schema });
      push('extract', performance.now() - t0);
      setState({ running: false, steps, result: out, modelInput });
    } catch (err) {
      setState({ running: false, steps, error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Extract JSON from active page"
      blurb="Scrape the page, take the first 5k chars, ask ai_extract_json to fill out a schema."
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
  const [state, setState] = useState<ScenarioState>(initialState);
  const [target, setTarget] = useState('es');

  const run = async () => {
    setState({ running: true, steps: [] });
    const steps: Step[] = [];
    const push = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    try {
      const page = await capturePage(push);
      // First non-trivial paragraph from the markdown.
      const para =
        page.markdown
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .find((p) => p.length > 80 && !p.startsWith('#') && !p.startsWith('!'))
          ?.slice(0, 1500) ?? page.markdown.slice(0, 800);
      push('extract paragraph', 0, `${para.length} chars`);
      const modelInput: ModelInput = {
        toolName: 'ai_translate → Translator API',
        config: { source_language: 'auto (detected per-call)', target_language: target },
        userInput: para,
        notes: [
          'The native Translator API takes only { sourceLanguage, targetLanguage } — no system prompt.',
          'When source_language is "auto" the wrapper first calls LanguageDetector to pick a source code.',
        ],
      };
      const t0 = performance.now();
      const out = await runHandler(ai_translate, {
        text: para,
        source_language: 'auto',
        target_language: target,
      });
      push('translate', performance.now() - t0, `→ ${target}`);
      setState({ running: false, steps, result: { input: para, output: out }, modelInput });
    } catch (err) {
      setState({ running: false, steps, error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Translate first paragraph"
      blurb="Scrape the page, find the first real paragraph, hand it to ai_translate. Auto-detects source language."
      toolNames={['read_active_page', 'ai_translate']}
      state={state}
      onRun={run}
      controls={
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">target</span>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-6 w-24 text-[11px]">
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
          output: { ok?: boolean; translation?: string; reason?: string; source_language?: string };
        };
        if (!o.output?.ok)
          return <ResultBlock label="failed" body={o.output?.reason ?? 'unknown'} />;
        return (
          <ResultBlock
            label={`translation (${o.output.source_language ?? '?'} → ${target})`}
            body={`--- input ---\n${o.input}\n\n--- output ---\n${o.output.translation ?? ''}`}
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
  const [state, setState] = useState<ScenarioState>(initialState);

  const run = async () => {
    setState({ running: true, steps: [] });
    const steps: Step[] = [];
    const push = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    try {
      const page = await capturePage(push);
      const sliced = page.markdown.slice(0, 1500);
      push('truncate', 0, `${sliced.length.toLocaleString()} chars`);
      const modelInput: ModelInput = {
        toolName: 'ai_detect_language → LanguageDetector API',
        userInput: sliced,
        notes: ['No system prompt or schema — just the input text.'],
      };
      const t0 = performance.now();
      const out = await runHandler(ai_detect_language, { text: sliced });
      push('detect', performance.now() - t0);
      setState({ running: false, steps, result: out, modelInput });
    } catch (err) {
      setState({ running: false, steps, error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Detect page language"
      blurb="Scrape the page, send first 1.5k chars to ai_detect_language."
      toolNames={['read_active_page', 'ai_detect_language']}
      state={state}
      onRun={run}
      renderResult={(r) => {
        const o = r as { ok?: boolean; candidates?: unknown; reason?: string };
        if (!o?.ok) return <ResultBlock label="failed" body={o?.reason ?? 'unknown'} />;
        return <ResultBlock label="candidates" body={JSON.stringify(o.candidates, null, 2)} />;
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: proofread current selection
 * ──────────────────────────────────────────────────────────────────────── */

function ProofreadSelectionScenario() {
  const [state, setState] = useState<ScenarioState>(initialState);

  const run = async () => {
    setState({ running: true, steps: [] });
    const steps: Step[] = [];
    const push = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    try {
      const tSel = performance.now();
      const sel = (await runHandler(get_page_selection, {})) as {
        text: string;
        selected: boolean;
      };
      push('get selection', performance.now() - tSel, `${sel.text.length} chars`);
      if (!sel.selected || !sel.text.trim()) {
        throw new Error('Nothing is selected on the active page. Highlight some text and retry.');
      }
      const modelInput: ModelInput = {
        toolName: 'ai_proofread → Proofreader API',
        userInput: sel.text,
        notes: [
          'The native Proofreader API takes only the text — no system prompt.',
          'Fallback path uses languageModel.prompt() with: "Proofread the following text. Return JSON with { corrected, corrections: [{ original, suggestion, reason }] }."',
        ],
      };
      const t0 = performance.now();
      const out = await runHandler(ai_proofread, { text: sel.text });
      push('proofread', performance.now() - t0);
      setState({ running: false, steps, result: { input: sel.text, output: out }, modelInput });
    } catch (err) {
      setState({ running: false, steps, error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Proofread selection"
      blurb="Read whatever the user has highlighted on the active page, send to ai_proofread."
      toolNames={['get_page_selection', 'ai_proofread']}
      state={state}
      onRun={run}
      renderResult={(r) => {
        const o = r as { input: string; output: Record<string, unknown> & { ok?: boolean } };
        if (!o.output?.ok) return <ResultBlock label="failed" body={JSON.stringify(o.output, null, 2)} />;
        return (
          <ResultBlock
            label="proofread"
            body={`--- input ---\n${o.input}\n\n--- output ---\n${JSON.stringify(o.output, null, 2)}`}
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
  const [state, setState] = useState<ScenarioState>(initialState);

  const run = async () => {
    setState({ running: true, steps: [] });
    const steps: Step[] = [];
    const push = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    try {
      const page = await capturePage(push);
      const sliced = page.markdown.slice(0, 6000);
      push('truncate', 0, `${sliced.length.toLocaleString()} chars`);
      const modelInput: ModelInput = {
        toolName: 'ai_check_prompt_injection → languageModel.prompt()',
        systemPrompt: buildInjectionSystemPrompt(page.url),
        responseConstraint: INJECTION_RESPONSE_SCHEMA,
        userInput: sliced,
      };
      const t0 = performance.now();
      const out = await runHandler(ai_check_prompt_injection, {
        text: sliced,
        source_hint: page.url,
      });
      push('inject-check', performance.now() - t0);
      setState({ running: false, steps, result: out, modelInput });
    } catch (err) {
      setState({ running: false, steps, error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Prompt-injection scan"
      blurb="Scrape the page, run the first 6k chars through ai_check_prompt_injection."
      toolNames={['read_active_page', 'ai_check_prompt_injection']}
      state={state}
      onRun={run}
      renderResult={(r) => {
        const o = r as {
          ok?: boolean;
          suspicious?: boolean;
          severity?: string;
          reason?: string;
          excerpts?: string[];
        };
        if (!o?.ok) return <ResultBlock label="failed" body={JSON.stringify(o, null, 2)} />;
        return <ResultBlock label="verdict" body={JSON.stringify(o, null, 2)} />;
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Scenario: describe first image on the page
 * ──────────────────────────────────────────────────────────────────────── */

async function fetchImageAsBase64(
  url: string,
): Promise<{ base64: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status} ${resp.statusText}`);
  const blob = await resp.blob();
  // Sniff: ai_describe_image only accepts png/jpeg/webp.
  let mime: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png';
  if (blob.type === 'image/jpeg') mime = 'image/jpeg';
  else if (blob.type === 'image/webp') mime = 'image/webp';
  else if (blob.type === 'image/png') mime = 'image/png';
  else throw new Error(`Unsupported image MIME: ${blob.type || 'unknown'}`);
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { base64: btoa(binary), mime, bytes: bytes.length };
}

function DescribeFirstImageScenario() {
  const [state, setState] = useState<ScenarioState>(initialState);
  const [question, setQuestion] = useState('Describe this image in detail.');

  const run = async () => {
    setState({ running: true, steps: [] });
    const steps: Step[] = [];
    const push = (label: string, ms: number, detail?: string) => {
      steps.push({ label, ms, detail });
      setState((s) => ({ ...s, steps: [...steps] }));
    };
    try {
      const page = await capturePage(push);
      if (!page.first_image_url) throw new Error('No images found on the active page.');
      const tFetch = performance.now();
      const img = await fetchImageAsBase64(page.first_image_url);
      push(
        'fetch image',
        performance.now() - tFetch,
        `${(img.bytes / 1024).toFixed(0)} KB · ${img.mime}`,
      );
      const modelInput: ModelInput = {
        toolName: 'ai_describe_image → languageModel.prompt() (multimodal)',
        config: {
          mime_type: img.mime,
          image_bytes: img.bytes,
          image_base64_chars: img.base64.length,
        },
        userInput: `[image: ${page.first_image_url}]\n\n${question}`,
        notes: [
          'No system prompt is set. The user message is a multimodal payload: { type: "text", value: <question> } + { type: "image", value: <Blob> }.',
          'Session is created with expectedInputs: [{ type: "text" }, { type: "image" }].',
        ],
      };
      const t0 = performance.now();
      const out = await runHandler(ai_describe_image, {
        image_base64: img.base64,
        mime_type: img.mime,
        question,
      });
      push('describe', performance.now() - t0);
      setState({
        running: false,
        steps,
        result: { url: page.first_image_url, output: out },
        modelInput,
      });
    } catch (err) {
      setState({ running: false, steps, error: (err as Error).message });
    }
  };

  return (
    <ScenarioCard
      title="Describe first image"
      blurb="Scrape the page, fetch the first image URL, base64-encode it, hand to ai_describe_image."
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
          output: { ok?: boolean; description?: string; reason?: string };
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
              <ResultBlock label="description" body={o.output.description ?? ''} />
            ) : (
              <ResultBlock label="failed" body={o.output?.reason ?? 'unknown'} />
            )}
          </div>
        );
      }}
    />
  );
}
