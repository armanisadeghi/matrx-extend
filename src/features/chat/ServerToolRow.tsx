/**
 * Compact inline row for server-side tool calls (the agent's own tools, e.g.
 * `seo_get_keyword_data`). Shown inside an assistant message bubble while it
 * streams: spinner + friendly label during execution, ✓ + tool name + duration
 * when complete. Click to expand args + result.
 *
 * Distinct from `ToolTimelineRow` which renders CLIENT (browser harness) tool
 * calls in the global timeline.
 */

import { cn } from '@/lib/utils';
import type { ServerToolCall } from '@/state/chat';
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';

export function ServerToolRow({ tool }: { tool: ServerToolCall }) {
  const [open, setOpen] = useState(false);

  const label = humanLabel(tool);
  const Icon =
    tool.phase === 'started' ? Loader2 : tool.phase === 'error' ? AlertTriangle : CheckCircle2;

  return (
    <div className="rounded-md border border-border/60 bg-card/40 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/30"
        aria-expanded={open}
      >
        <ChevronRight
          className={`size-3 text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            tool.phase === 'started' && 'animate-spin text-primary',
            tool.phase === 'completed' && 'text-emerald-600 dark:text-emerald-400',
            tool.phase === 'error' && 'text-red-600 dark:text-red-400',
          )}
        />
        <span className="truncate text-foreground">{label}</span>
        {tool.phase !== 'started' && tool.endedAt && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {Math.max(1, tool.endedAt - tool.startedAt)}ms
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/60 px-2.5 py-1.5">
          <DetailBlock label="tool" value={tool.toolName} />
          {tool.args != null && <DetailBlock label="args" value={tool.args} />}
          {tool.phase === 'completed' && tool.result != null && (
            <DetailBlock label="result" value={tool.result} />
          )}
          {tool.phase === 'error' && (
            <DetailBlock label="error" value={tool.result ?? tool.message} />
          )}
        </div>
      )}
    </div>
  );
}

function humanLabel(tool: ServerToolCall): string {
  // Prefer the server-supplied "Executing X" message while running. When done,
  // the server returns "Done" — fall back to the title-cased tool name.
  if (tool.phase === 'started' && tool.message) return tool.message;
  return titleCase(tool.toolName);
}

function titleCase(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(' ');
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  let body: string;
  if (typeof value === 'string') body = value;
  else {
    try {
      body = JSON.stringify(value, null, 2);
    } catch {
      body = String(value);
    }
  }
  if (!body) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="mt-0.5 max-h-48 overflow-auto rounded-md bg-background/60 p-1.5 text-[11px] leading-snug">
        {body}
      </pre>
    </div>
  );
}
