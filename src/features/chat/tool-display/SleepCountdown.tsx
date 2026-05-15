/**
 * Custom row for `sleep` — shows a live countdown while running ("Sleeping
 * 1.7s remaining") and a final duration when complete ("Slept 2.00s"). The
 * default ConfigurableToolRow can't tick on its own, so sleep takes over with
 * its own setInterval-driven render.
 */

import { cn } from '@/lib/utils';
import { AlertTriangle, Loader2, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ShimmerText } from '../BreathingOrb';
import type { ToolTimelineEntry } from '../ToolTimelineRow';
import { CopyToolButton } from './CopyToolButton';

type Phase = 'started' | 'completed' | 'error';

function readNumber(obj: unknown, key: string): number | undefined {
  if (obj == null || typeof obj !== 'object') return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function formatSeconds(ms: number, digits = 1): string {
  return `${(ms / 1000).toFixed(digits)}s`;
}

export function SleepCountdown({ entry }: { entry: ToolTimelineEntry; kind: 'server' | 'client' }) {
  const phase = entry.phase as Phase;
  const targetMs = readNumber(entry.args, 'ms') ?? 0;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== 'started') return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [phase, entry.startedAt]);

  const elapsed = Math.max(0, now - entry.startedAt);
  const remaining = Math.max(0, targetMs - elapsed);

  let label: string;
  let infoText = '';
  if (phase === 'started') {
    label = targetMs > 0 ? `Sleeping ${formatSeconds(targetMs, 0)}` : 'Sleeping';
    infoText = targetMs > 0 ? `${formatSeconds(remaining)} remaining` : formatSeconds(elapsed);
  } else if (phase === 'completed') {
    const sleptMs = readNumber(entry.output, 'slept_ms') ?? targetMs;
    label = 'Slept';
    infoText = formatSeconds(sleptMs, 2);
  } else {
    label = 'Sleep failed';
  }

  const Icon = phase === 'started' ? Loader2 : phase === 'completed' ? Moon : AlertTriangle;
  const colorClass =
    phase === 'error'
      ? 'text-red-600 dark:text-red-400'
      : phase === 'completed'
        ? 'text-slate-600 dark:text-slate-400'
        : 'text-primary';

  return (
    <div className="group rounded py-0.5 pr-1 text-xs hover:bg-muted/40">
      <div className="flex w-full items-center gap-1.5">
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            colorClass,
            phase === 'started' && 'animate-spin',
          )}
        />
        <span className="truncate text-foreground">
          {phase === 'started' ? <ShimmerText>{label}</ShimmerText> : label}
        </span>
        {infoText && (
          <span className="font-mono text-muted-foreground tabular-nums">{infoText}</span>
        )}
        {phase !== 'started' && entry.endedAt && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {Math.max(1, entry.endedAt - entry.startedAt)}ms
          </span>
        )}
        <CopyToolButton
          data={{
            toolName: entry.toolName,
            args: entry.args,
            result: entry.output,
            message: entry.message,
            phase,
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
            callId: entry.callId,
          }}
        />
      </div>
    </div>
  );
}
