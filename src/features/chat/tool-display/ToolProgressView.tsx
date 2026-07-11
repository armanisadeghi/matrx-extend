/**
 * Renders the incremental progress log a long-running tool emits. Shown ONLY
 * when a tool actually reported progress — every other tool renders nothing
 * here, so this never becomes the default chrome for normal tool calls.
 *
 * Three modes (registry-selectable via `ProgressConfig.mode`, default 'log'):
 *   - 'log'    chronological recent lines while running; collapses to a
 *              "N updates" toggle once the tool finishes (unless showWhenComplete)
 *   - 'latest' a single status line that the latest update replaces
 *   - 'steps'  named steps grouped by `step`, ticking pending→active→done/error
 *
 * Used by both the configurable rows and the default rows (the generic
 * fallback), so a tool that emits progress but has no registry entry still
 * gets a sensible display.
 */

import { cn } from '@/lib/utils';
import type { ToolProgressEntry } from '@/state/chat';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { Phase, ProgressConfig } from './types';

interface Props {
  progress: ToolProgressEntry[] | undefined;
  phase: Phase;
  cfg?: ProgressConfig | undefined;
}

export function ToolProgressView({ progress, phase, cfg }: Props) {
  const entries = progress ?? [];
  if (entries.length === 0) return null;

  const mode = cfg?.mode ?? 'log';
  const running = phase === 'started';
  const showWhenComplete = cfg?.showWhenComplete ?? false;

  if (mode === 'steps') {
    return <StepsProgress entries={entries} running={running} />;
  }
  if (mode === 'latest') {
    return <LatestProgress entries={entries} running={running} />;
  }
  return (
    <LogProgress
      entries={entries}
      running={running}
      showWhenComplete={showWhenComplete}
      visibleWhileRunning={cfg?.visibleWhileRunning ?? 4}
    />
  );
}

const lineClass = 'flex items-center gap-1.5 text-[11px] leading-snug text-muted-foreground';
const wrapClass = 'mt-1 ml-5 border-l border-border/50 pl-2 space-y-0.5';

function entryLabel(e: ToolProgressEntry): string {
  return e.label ?? e.step ?? e.status ?? '…';
}

/** Thin progress bar when a percent (0–1 or 0–100) is present. */
function PercentBar({ percent }: { percent: number }) {
  const pct = percent <= 1 ? percent * 100 : percent;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className="ml-auto inline-flex items-center gap-1">
      <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="tabular-nums text-[9px]">{Math.round(clamped)}%</span>
    </span>
  );
}

function LogProgress({
  entries,
  running,
  showWhenComplete,
  visibleWhileRunning,
}: {
  entries: ToolProgressEntry[];
  running: boolean;
  showWhenComplete: boolean;
  visibleWhileRunning: number;
}) {
  const [open, setOpen] = useState(false);

  // Once finished, collapse to a compact toggle unless asked to stay open.
  if (!running && !showWhenComplete) {
    return (
      <div className="mt-1 ml-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {entries.length} update{entries.length === 1 ? '' : 's'}
        </button>
        {open && (
          <div className={wrapClass}>
            {entries.map((e, i) => (
              <ProgressLine key={i} e={e} active={false} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // While running, show the most recent N lines (oldest first), newest active.
  const visible = entries.slice(-visibleWhileRunning);
  const hiddenCount = entries.length - visible.length;
  return (
    <div className={wrapClass}>
      {hiddenCount > 0 && (
        <div className="text-[9px] text-muted-foreground/60">+{hiddenCount} earlier</div>
      )}
      {visible.map((e, i) => {
        const isLatest = i === visible.length - 1;
        return <ProgressLine key={i} e={e} active={running && isLatest} />;
      })}
    </div>
  );
}

function ProgressLine({ e, active }: { e: ToolProgressEntry; active: boolean }) {
  const errored = e.status === 'error';
  return (
    <div className={cn(lineClass, errored && 'text-red-600 dark:text-red-400')}>
      {active ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
      ) : errored ? (
        <AlertTriangle className="size-3 shrink-0" />
      ) : (
        <span className="size-3 shrink-0 text-center text-muted-foreground/40">·</span>
      )}
      <span className={cn(active ? 'truncate text-foreground' : 'truncate')}>{entryLabel(e)}</span>
      {typeof e.percent === 'number' && <PercentBar percent={e.percent} />}
    </div>
  );
}

function LatestProgress({
  entries,
  running,
}: {
  entries: ToolProgressEntry[];
  running: boolean;
}) {
  const last = entries[entries.length - 1];
  if (!last) return null;
  return (
    <div className={wrapClass}>
      <ProgressLine e={last} active={running} />
    </div>
  );
}

/**
 * Collapse the log into named steps (latest status per `step`, first-seen
 * order). Entries without a `step` are bucketed under their label so a tool
 * that mixes both still renders sanely.
 */
function StepsProgress({
  entries,
  running,
}: {
  entries: ToolProgressEntry[];
  running: boolean;
}) {
  const order: string[] = [];
  const latest = new Map<string, ToolProgressEntry>();
  for (const e of entries) {
    const key = e.step ?? e.label ?? '…';
    if (!latest.has(key)) order.push(key);
    latest.set(key, e);
  }
  return (
    <div className={wrapClass}>
      {order.map((key) => {
        const e = latest.get(key);
        if (!e) return null;
        const status = e.status ?? (running ? 'active' : 'done');
        return (
          <div
            key={key}
            className={cn(
              lineClass,
              status === 'error' && 'text-red-600 dark:text-red-400',
              status === 'done' && 'text-foreground',
            )}
          >
            <StepIcon status={status} />
            <span className="truncate">{e.label ?? key}</span>
            {typeof e.percent === 'number' && <PercentBar percent={e.percent} />}
          </div>
        );
      })}
    </div>
  );
}

function StepIcon({ status }: { status: NonNullable<ToolProgressEntry['status']> }) {
  if (status === 'active') return <Loader2 className="size-3 shrink-0 animate-spin text-primary" />;
  if (status === 'done')
    return <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (status === 'error') return <AlertTriangle className="size-3 shrink-0" />;
  return <span className="size-3 shrink-0 rounded-full border border-muted-foreground/40" />;
}
