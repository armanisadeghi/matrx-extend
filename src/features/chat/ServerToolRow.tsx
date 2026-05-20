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
import { ConfigurableToolRow, ToolDisplayBoundary } from './tool-display/ConfigurableToolRow';
import { CopyToolButton } from './tool-display/CopyToolButton';
import { ToolProgressView } from './tool-display/ToolProgressView';
import { toolDisplayRegistry } from './tool-display/registry';
import type { ToolTimelineEntry } from './ToolTimelineRow';

export function ServerToolRow({ tool }: { tool: ServerToolCall }) {
  const cfg = toolDisplayRegistry[tool.toolName];
  if (cfg) {
    const entry: ToolTimelineEntry = {
      callId: tool.callId,
      toolName: tool.toolName,
      startedAt: tool.startedAt,
      endedAt: tool.endedAt,
      phase: tool.phase,
      args: tool.args,
      output: tool.result,
      message: tool.message,
      progress: tool.progress,
    };
    const fallback = <DefaultServerToolRow tool={tool} />;
    if (cfg.CustomComponent) {
      const Custom = cfg.CustomComponent;
      return (
        <ToolDisplayBoundary toolName={tool.toolName} fallback={fallback}>
          <Custom entry={entry} kind="server" />
        </ToolDisplayBoundary>
      );
    }
    return (
      <ToolDisplayBoundary toolName={tool.toolName} fallback={fallback}>
        <ConfigurableToolRow entry={entry} kind="server" cfg={cfg} />
      </ToolDisplayBoundary>
    );
  }
  return <DefaultServerToolRow tool={tool} />;
}

function DefaultServerToolRow({ tool }: { tool: ServerToolCall }) {
  const [open, setOpen] = useState(false);

  const label = humanLabel(tool);
  const Icon =
    tool.phase === 'started' ? Loader2 : tool.phase === 'error' ? AlertTriangle : CheckCircle2;

  return (
    <div className="group rounded py-0.5 pr-1 text-xs hover:bg-muted/40">
      <div className="flex w-full items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground transition-transform ${
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
        <CopyToolButton
          data={{
            toolName: tool.toolName,
            args: tool.args,
            result: tool.result,
            message: tool.message,
            phase: tool.phase,
            startedAt: tool.startedAt,
            endedAt: tool.endedAt,
            callId: tool.callId,
          }}
        />
      </div>
      {/* Generic progress display — only renders when the tool emitted any. */}
      <ToolProgressView progress={tool.progress} phase={tool.phase} />
      {open && (
        <div className="mt-1 ml-5 space-y-1.5">
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
