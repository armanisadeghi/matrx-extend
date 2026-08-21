/**
 * Custom row for `chrome_batch` — the meta-tool that bundles N read-tier
 * tool calls into a single SSE round trip. Showing it as one opaque entry
 * hides what's actually happening; instead we render each sub-call as its
 * own native tool row, complete with the full tool-display registry styling
 * (favicon icons, polished prefixes, custom result components). The batch
 * itself only contributes a thin header indicating "Batch — N calls".
 *
 * Sub-call shape (from `src/lib/tools/handlers/batch.ts`):
 *   args.calls   = [{ name, arguments }, ...]
 *   output.results = [{ name, category, ok, output | error, ... }, ...]
 *
 * Phase resolution per sub-call:
 *   - batch phase 'started'   → every sub starts as 'started'
 *   - batch phase 'completed' → sub completed unless its `ok` is false OR
 *                               its `output.ok` is false (then 'error')
 *   - batch phase 'error'     → every sub marked 'error'
 */

import { cn } from '@/lib/utils';
import { AlertTriangle, Layers, Loader2 } from 'lucide-react';
import { ShimmerText } from '../BreathingOrb';
import { type ToolTimelineEntry, ToolTimelineRow } from '../ToolTimelineRow';

type Phase = 'started' | 'completed' | 'error';

interface SubCallArg {
  name?: string;
  arguments?: unknown;
}

interface SubCallResult {
  name?: string;
  ok?: boolean;
  output?: unknown;
  error?: unknown;
}

function readArray<T>(value: unknown, key: string): T[] {
  if (value == null || typeof value !== 'object') return [];
  const v = (value as Record<string, unknown>)[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

function resolveSubPhase(batchPhase: Phase, sub: SubCallResult | undefined): Phase {
  if (batchPhase === 'started') return 'started';
  if (batchPhase === 'error') return 'error';
  if (!sub) return 'started';
  if (sub.ok === false) return 'error';
  // Inner result may carry its own ok flag (e.g. fetch_url_as_markdown
  // returns `{ ok: false, reason: 'HTTP 404' }` on a 4xx without throwing).
  if (sub.output != null && typeof sub.output === 'object') {
    const innerOk = (sub.output as Record<string, unknown>).ok;
    if (innerOk === false) return 'error';
  }
  return 'completed';
}

function pickOutput(sub: SubCallResult | undefined): unknown {
  if (!sub) return undefined;
  if (sub.output !== undefined) return sub.output;
  if (sub.error !== undefined) return sub.error;
  return undefined;
}

function pickMessage(sub: SubCallResult | undefined): string | undefined {
  if (!sub) return undefined;
  if (sub.output != null && typeof sub.output === 'object') {
    const reason = (sub.output as Record<string, unknown>).reason;
    if (typeof reason === 'string' && reason.trim()) return reason;
  }
  if (typeof sub.error === 'string') return sub.error;
  return undefined;
}

export function BatchToolDisplay({
  entry,
}: {
  entry: ToolTimelineEntry;
  kind: 'server' | 'client';
}) {
  const phase = entry.phase as Phase;
  const calls = readArray<SubCallArg>(entry.args, 'calls');
  const results = readArray<SubCallResult>(entry.output, 'results');

  // Split the batch wall-clock evenly across sub-calls so the per-row
  // duration display stays meaningful (we don't get per-sub timestamps
  // from the handler today; if that ever ships, prefer those instead).
  const totalMs = entry.endedAt != null ? Math.max(1, entry.endedAt - entry.startedAt) : 0;
  const perCallMs = calls.length > 0 ? Math.max(1, Math.floor(totalMs / calls.length)) : 0;

  const Icon = phase === 'started' ? Loader2 : phase === 'error' ? AlertTriangle : Layers;
  const colorClass =
    phase === 'error'
      ? 'text-red-600 dark:text-red-400'
      : phase === 'completed'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-primary';

  const subEntries: ToolTimelineEntry[] = calls.map((call, i) => {
    const sub = results[i];
    const subPhase = resolveSubPhase(phase, sub);
    const subStart = entry.startedAt + i * perCallMs;
    return {
      callId: `${entry.callId}__${i}`,
      toolName: String(call?.name ?? sub?.name ?? '(unknown)'),
      startedAt: subStart,
      ...(phase === 'started' ? {} : { endedAt: subStart + perCallMs }),
      phase: subPhase,
      args: call?.arguments,
      ...(subPhase !== 'started' ? { output: pickOutput(sub) } : {}),
      ...(pickMessage(sub) != null ? { message: pickMessage(sub) } : {}),
    };
  });

  const headerText =
    phase === 'started'
      ? `Running batch — ${calls.length} calls`
      : phase === 'error'
        ? 'Batch failed'
        : `Batch — ${calls.length} calls`;

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <Icon
          className={cn('size-3.5 shrink-0', colorClass, phase === 'started' && 'animate-spin')}
        />
        <span className="text-muted-foreground">
          {phase === 'started' ? <ShimmerText>{headerText}</ShimmerText> : headerText}
        </span>
        {phase !== 'started' && entry.endedAt && (
          <span className="ml-auto text-[10px] text-muted-foreground">{totalMs}ms</span>
        )}
      </div>
      <div className="ml-4 space-y-0.5 border-l border-border/40 pl-2">
        {subEntries.map((sub) => (
          <ToolTimelineRow key={sub.callId} entry={sub} />
        ))}
      </div>
    </div>
  );
}
