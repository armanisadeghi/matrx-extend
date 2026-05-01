/**
 * Tools tab — visible catalog of every client-side tool the agent can call.
 *
 * Three things you can do here:
 *   1. Browse — filter by tier or bundle, search, see description + schema.
 *   2. Inspect — expand to view the JSON Schema and required Chrome perms.
 *   3. Test — fill in args (JSON), hit "Run", see the result inline. The
 *      tool runs through the SAME dispatcher path as the agent, so this is
 *      a true end-to-end smoke test (including approval prompts for
 *      action-tier tools when you're in Ask mode).
 *
 * The "Run" button calls the handler directly — no SSE round-trip. It
 * skips the permission gate (since it's user-initiated) but flows the
 * result through TOOL_TIMELINE_EVENT so the same UI you see during agent
 * runs renders here too.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { log } from '@/lib/debug/log';
import { newId } from '@/lib/id';
import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { listAllHandlers } from '@/lib/tools/registry';
import type { AnyToolHandler, ToolTier } from '@/lib/tools/types';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  HandMetal,
  Loader2,
  Play,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { zodToJsonSchema } from 'zod-to-json-schema';

type TierFilter = 'all' | ToolTier;

export function ToolsView() {
  const handlers = useMemo(() => listAllHandlers(), []);
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return handlers.filter((h) => {
      if (tier !== 'all' && h.tier !== tier) return false;
      if (!q) return true;
      return h.name.toLowerCase().includes(q) || h.description.toLowerCase().includes(q);
    });
  }, [handlers, query, tier]);

  const counts = useMemo(() => {
    const c: Record<ToolTier, number> = {
      read: 0,
      action: 0,
      'ask-user': 0,
      privileged: 0,
    };
    for (const h of handlers) c[h.tier]++;
    return c;
  }, [handlers]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <Wrench className="size-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Tools</span>
          <span className="text-[11px] text-muted-foreground">{handlers.length} total</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 pb-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or description…"
          className="h-7 flex-1 text-xs"
        />
        <Select value={tier} onValueChange={(v) => setTier(v as TierFilter)}>
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({handlers.length})</SelectItem>
            <SelectItem value="read">Read ({counts.read})</SelectItem>
            <SelectItem value="action">Action ({counts.action})</SelectItem>
            <SelectItem value="ask-user">Ask-user ({counts['ask-user']})</SelectItem>
            <SelectItem value="privileged">Privileged ({counts.privileged})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">No tools match.</div>
        ) : (
          <div className="space-y-1.5">
            {filtered.map((h) => (
              <ToolRow key={h.name} handler={h} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolRow({ handler }: { handler: AnyToolHandler }) {
  const [open, setOpen] = useState(false);

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
            <span className="font-mono text-[12px] font-medium">{handler.name}</span>
            <TierBadge tier={handler.tier} />
            {handler.admin_only && (
              <Badge
                variant="outline"
                className="h-4 border-amber-300 bg-amber-50 px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-400"
              >
                admin
              </Badge>
            )}
            {handler.required_optional_permissions?.length ? (
              <Badge
                variant="outline"
                className="h-4 border-purple-300 bg-purple-50 px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-purple-700 dark:border-purple-700/50 dark:bg-purple-950/30 dark:text-purple-400"
                title={`Requires: ${handler.required_optional_permissions.join(', ')}`}
              >
                opt-perm
              </Badge>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {handler.description}
          </div>
        </div>
      </button>

      {open && <ToolDetail handler={handler} />}
    </div>
  );
}

function TierBadge({ tier }: { tier: ToolTier }) {
  const map: Record<
    ToolTier,
    { label: string; cls: string; icon: typeof Eye | typeof HandMetal | typeof ShieldAlert }
  > = {
    read: {
      label: 'read',
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-400',
      icon: Eye,
    },
    action: {
      label: 'action',
      cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-400',
      icon: HandMetal,
    },
    'ask-user': {
      label: 'ask',
      cls: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700/40 dark:bg-sky-950/30 dark:text-sky-400',
      icon: HandMetal,
    },
    privileged: {
      label: 'privileged',
      cls: 'border-red-200 bg-red-50 text-red-700 dark:border-red-700/40 dark:bg-red-950/30 dark:text-red-400',
      icon: ShieldAlert,
    },
  };
  const cfg = map[tier];
  const Icon = cfg.icon;
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-4 gap-0.5 border px-1 py-0 text-[9px] font-medium uppercase tracking-wide',
        cfg.cls,
      )}
    >
      <Icon className="size-2.5" />
      {cfg.label}
    </Badge>
  );
}

function ToolDetail({ handler }: { handler: AnyToolHandler }) {
  const schema = useMemo(
    () => zodToJsonSchema(handler.argsSchema, { $refStrategy: 'none', target: 'jsonSchema7' }),
    [handler],
  );
  const sampleArgs = useMemo(() => buildSampleArgs(schema), [schema]);
  const [argsText, setArgsText] = useState(sampleArgs);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);

  const runManually = async () => {
    setError(null);
    setResult(undefined);
    let parsedArgs: unknown;
    try {
      parsedArgs = argsText.trim() ? JSON.parse(argsText) : {};
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    const validated = handler.argsSchema.safeParse(parsedArgs);
    if (!validated.success) {
      setError(`Schema mismatch:\n${JSON.stringify(validated.error.format(), null, 2)}`);
      return;
    }
    const callId = newId('manual');
    setRunning(true);
    broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
      callId,
      toolName: handler.name,
      phase: 'started',
      args: validated.data,
    });
    try {
      const out = await handler.run(validated.data as never, {
        conversationId: null,
        runId: 'manual-test',
        callId,
        agentName: 'manual',
        permissionMode: 'act',
      });
      setResult(out);
      broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
        callId,
        toolName: handler.name,
        phase: 'completed',
        output: out,
      });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setError(msg);
      log.error('msg', `manual tool ${handler.name} threw`, e);
      broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
        callId,
        toolName: handler.name,
        phase: 'error',
        message: msg,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-2 border-t px-2.5 py-2 text-[11px]">
      <Section label="description">
        <div className="text-foreground/80">{handler.description}</div>
      </Section>

      <Section label="input schema (JSON Schema 7)">
        <pre className="max-h-60 overflow-auto rounded bg-background/60 p-1.5 text-[10px] leading-snug">
          {JSON.stringify(schema, null, 2)}
        </pre>
      </Section>

      <Section label="test runner">
        <Textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          rows={Math.max(3, Math.min(10, argsText.split('\n').length + 1))}
          className="font-mono text-[11px]"
          placeholder='{"selector": "h1"}'
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <Button size="sm" className="h-6 gap-1" onClick={runManually} disabled={running}>
            {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Run
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6"
            onClick={() => setArgsText(sampleArgs)}
            disabled={running}
          >
            Reset args
          </Button>
          {handler.tier !== 'read' && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              Test mode bypasses approval
            </span>
          )}
        </div>
      </Section>

      {error && (
        <Section label="error">
          <pre className="max-h-40 overflow-auto rounded bg-red-50 p-1.5 text-[10px] leading-snug text-red-800 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </pre>
        </Section>
      )}
      {result !== undefined && !error && (
        <Section label="output">
          <pre className="max-h-60 overflow-auto rounded bg-background/60 p-1.5 text-[10px] leading-snug">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** Produce a minimum valid args object the user can edit. */
function buildSampleArgs(schema: ReturnType<typeof zodToJsonSchema>): string {
  const root = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  if (root.type !== 'object' || !root.properties) return '{}';
  const out: Record<string, unknown> = {};
  for (const key of root.required ?? []) {
    out[key] = sampleForProp(root.properties[key]);
  }
  return JSON.stringify(out, null, 2);
}

function sampleForProp(prop: unknown): unknown {
  const p = prop as { type?: string | string[]; enum?: unknown[]; default?: unknown };
  if (p?.default !== undefined) return p.default;
  if (Array.isArray(p?.enum) && p.enum.length > 0) return p.enum[0];
  const t = Array.isArray(p?.type) ? p.type[0] : p?.type;
  switch (t) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}
