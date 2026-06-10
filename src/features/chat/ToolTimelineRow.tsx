/**
 * Compact inline row showing what a tool did. Rendered inside the chat scroll
 * for any timeline entry that's NOT currently being approved/asked. Click the
 * row to expand args + output JSON.
 */

import { cn } from '@/lib/utils';
import type { ToolProgressEntry } from '@/state/chat';
import { AlertTriangle, CheckCircle2, Loader2, Shield } from 'lucide-react';
import { useState } from 'react';
import { ToolReceiptDialog } from './ToolReceiptDialog';
import { ConfigurableToolRow, ToolDisplayBoundary } from './tool-display/ConfigurableToolRow';
import { CopyToolButton } from './tool-display/CopyToolButton';
import { ToolProgressView } from './tool-display/ToolProgressView';
import { toolDisplayRegistry } from './tool-display/registry';

/**
 * Display shape for a tool entry rendered inline. The chat-store's
 * `MessagePart` of type 'tool' projects to this shape — kept here so the
 * row can also be used with a one-shot ad-hoc payload (e.g. the manual
 * test runner in the Tools tab).
 */
export interface ToolTimelineEntry {
  callId: string;
  toolName: string;
  startedAt: number;
  endedAt?: number;
  phase: 'started' | 'completed' | 'error';
  args?: unknown;
  output?: unknown;
  message?: string;
  /** Incremental progress log (long-running tools only; usually absent). */
  progress?: ToolProgressEntry[];
}

export function ToolTimelineRow({ entry }: { entry: ToolTimelineEntry }) {
  const cfg = toolDisplayRegistry[entry.toolName];
  if (cfg) {
    const fallback = <DefaultToolTimelineRow entry={entry} />;
    if (cfg.CustomComponent) {
      const Custom = cfg.CustomComponent;
      return (
        <ToolDisplayBoundary toolName={entry.toolName} fallback={fallback}>
          <Custom entry={entry} kind="client" />
        </ToolDisplayBoundary>
      );
    }
    return (
      <ToolDisplayBoundary toolName={entry.toolName} fallback={fallback}>
        <ConfigurableToolRow entry={entry} kind="client" cfg={cfg} />
      </ToolDisplayBoundary>
    );
  }
  return <DefaultToolTimelineRow entry={entry} />;
}

function DefaultToolTimelineRow({ entry }: { entry: ToolTimelineEntry }) {
  const [open, setOpen] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const Icon =
    entry.phase === 'started' ? Loader2 : entry.phase === 'error' ? AlertTriangle : CheckCircle2;

  const argSummary = summarize(entry.args);

  return (
    <div className="group rounded py-0.5 pr-1 text-xs hover:bg-muted/40">
      <div className="flex w-full items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-1.5 text-left"
        >
          <Icon
            className={cn(
              'size-3.5 shrink-0',
              entry.phase === 'started' && 'animate-spin text-primary',
              entry.phase === 'completed' && 'text-emerald-600 dark:text-emerald-400',
              entry.phase === 'error' && 'text-red-600 dark:text-red-400',
            )}
          />
          <span className="font-mono text-[11px] font-medium">{entry.toolName}</span>
          {argSummary && <span className="truncate text-muted-foreground">{argSummary}</span>}
          {entry.phase === 'completed' && entry.endedAt && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {Math.max(1, entry.endedAt - entry.startedAt)}ms
            </span>
          )}
        </button>
        <ShowReceiptButton callId={entry.callId} onOpen={() => setShowReceipt(true)} />
        <CopyToolButton
          data={{
            toolName: entry.toolName,
            args: entry.args,
            result: entry.output,
            message: entry.message,
            phase: entry.phase,
            startedAt: entry.startedAt,
            endedAt: entry.endedAt,
            callId: entry.callId,
          }}
        />
      </div>
      {/* Generic progress display — only renders when the tool emitted any. */}
      <ToolProgressView progress={entry.progress} phase={entry.phase} />
      {open && (
        <div className="mt-1 ml-5 space-y-1.5">
          <DetailBlock label="args" value={entry.args} />
          {entry.phase === 'completed' && <DetailBlock label="output" value={entry.output} />}
          {entry.phase === 'error' && entry.message && (
            <DetailBlock label="error" value={entry.message} />
          )}
        </div>
      )}
      {showReceipt && (
        <ToolReceiptDialog
          callId={entry.callId}
          toolName={entry.toolName}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </div>
  );
}

/**
 * Hover-reveal button mounted on every timeline row that opens the
 * cryptographic receipt for the call. Uses the same opacity-0
 * group-hover pattern as `CopyToolButton` so it never adds visual
 * noise to the row at rest.
 */
function ShowReceiptButton({
  callId,
  onOpen,
}: {
  callId: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title="Show receipt"
      aria-label={`Show receipt for ${callId}`}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
    >
      <Shield className="size-3" />
    </button>
  );
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

function summarize(args: unknown): string | null {
  if (args == null) return null;
  if (typeof args === 'string') return args.length > 80 ? `${args.slice(0, 80)}…` : args;
  if (typeof args !== 'object') return String(args);
  const obj = args as Record<string, unknown>;
  // Grab the most relevant primitive field.
  for (const k of ['url', 'selector', 'text', 'question', 'reason']) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) return null;
  return keys.slice(0, 3).join(', ');
}
