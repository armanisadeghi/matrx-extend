/**
 * Small clipboard button that copies the full tool-call payload (name, args,
 * result/output, error message, phase, duration, callId) as pretty-printed
 * JSON. Used by every row variant — default and configurable. Shows a green
 * check for ~1.5s after a successful copy.
 *
 * The button stops click propagation so it doesn't toggle the row open/close
 * when the parent row is also clickable.
 */

import { cn } from '@/lib/utils';
import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export interface ToolCopyData {
  toolName: string;
  args?: unknown;
  result?: unknown;
  message?: string;
  phase: 'started' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  callId?: string;
}

/**
 * Build the JSON payload that gets written to the clipboard. Stable shape so
 * downstream tools (the user pasting into a bug report, an LLM, etc.) can
 * rely on it.
 *
 * `args` and `result` are ALWAYS present (defaulted to null when missing) so
 * the user can tell the difference between "no input recorded" and "input
 * happened to be empty". Other fields are only included when meaningful.
 */
function buildPayload(data: ToolCopyData): string {
  const payload: Record<string, unknown> = {
    tool: data.toolName,
    phase: data.phase,
    args: data.args ?? null,
    result: data.result ?? null,
  };
  if (data.message !== undefined) {
    // `message` is a phase-shared field — "Executing X" while running, "Done"
    // on success, the failure reason on error. Only treat it as an `error`
    // when the phase actually failed; otherwise emit it as `message`.
    if (data.phase === 'error') payload.error = data.message;
    else payload.message = data.message;
  }
  if (data.endedAt !== undefined) payload.duration_ms = Math.max(0, data.endedAt - data.startedAt);
  if (data.callId !== undefined) payload.callId = data.callId;
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function CopyToolButton({ data, className }: { data: ToolCopyData; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const text = buildPayload(data);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      } catch (err) {
        console.warn('[tool-display] clipboard write failed', err);
      }
    },
    [data],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      title={copied ? 'Copied!' : 'Copy tool data'}
      aria-label="Copy tool data"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground focus:opacity-100 group-hover:opacity-100',
        copied && 'opacity-100 text-emerald-600 dark:text-emerald-400',
        className,
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}
