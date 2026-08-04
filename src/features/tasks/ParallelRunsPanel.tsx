/**
 * ParallelRunsPanel — live status panel for `parallel_for_each_tab`.
 *
 * Rendered at the top of the Tasks tab. While at least one parallel
 * orchestration is in flight (or recently finished and not dismissed), this
 * panel shows:
 *   - One row per session: started time, prompt, X of N running / Y completed / Z failed
 *   - Per-sub-run accordion: tab title + URL, status pill, accumulated text,
 *     error message
 *   - Dismiss button per session (clears it from the panel)
 *
 * The orchestration runs in the SW; this surface only listens to the
 * PARALLEL_RUN_EVENT broadcast and mirrors the state into a sidepanel-side
 * zustand store so the UI updates live without re-querying anything.
 */

import { Button } from '@/components/ui/button';
import {
  type ParallelSession,
  type ParallelSubRun,
  useParallelRunsStore,
} from '@/state/parallel-runs';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  TimerOff,
  X,
} from 'lucide-react';
import { useState } from 'react';

function StatusPill({ status }: { status: ParallelSubRun['status'] }) {
  if (status === 'completed')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3" /> done
      </span>
    );
  if (status === 'error')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
        <AlertTriangle className="size-3" /> error
      </span>
    );
  if (status === 'timeout')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
        <TimerOff className="size-3" /> timeout
      </span>
    );
  if (status === 'running')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
        <Loader2 className="size-3 animate-spin" /> running
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      pending
    </span>
  );
}

function SubRunRow({ sub }: { sub: ParallelSubRun }) {
  const [open, setOpen] = useState(false);
  const elapsed = sub.endedAt ? sub.endedAt - sub.startedAt : null;
  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/50"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusPill status={sub.status} />
            <span className="text-xs font-medium">tab {sub.tabId}</span>
            {elapsed != null && (
              <span className="text-[10px] text-muted-foreground">
                {(elapsed / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {sub.tabTitle ?? sub.tabUrl ?? '(no title)'}
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t bg-muted/30 px-2 py-1.5 text-[11px]">
          {sub.tabUrl && (
            <div className="mb-1 truncate text-muted-foreground">
              <span className="font-medium">URL:</span> {sub.tabUrl}
            </div>
          )}
          {sub.error && (
            <div className="mb-1 rounded bg-destructive/10 px-1.5 py-1 text-destructive">
              {sub.error}
            </div>
          )}
          {sub.text && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-foreground">
              {sub.text}
            </pre>
          )}
          {sub.dataEvents.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground">
                {sub.dataEvents.length} data event(s)
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                {JSON.stringify(sub.dataEvents, null, 2)}
              </pre>
            </details>
          )}
          {!sub.text && !sub.error && sub.dataEvents.length === 0 && (
            <div className="text-muted-foreground italic">
              {sub.status === 'running' ? 'streaming…' : 'no output'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: ParallelSession }) {
  const toggleCollapsed = useParallelRunsStore((s) => s.toggleCollapsed);
  const removeSession = useParallelRunsStore((s) => s.removeSession);
  const subs = Object.values(session.subRuns);
  const total = subs.length;
  const completed = subs.filter((s) => s.status === 'completed').length;
  const errored = subs.filter((s) => s.status === 'error').length;
  const timedOut = subs.filter((s) => s.status === 'timeout').length;
  const running = subs.filter((s) => s.status === 'running' || s.status === 'pending').length;
  const isFinished = session.endedAt != null;

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => toggleCollapsed(session.parentCallId)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {session.collapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {!isFinished && <Loader2 className="size-3 animate-spin text-blue-500" />}
              parallel_for_each_tab
              <span className="text-[10px] text-muted-foreground">· {total} tabs</span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground">{session.subPrompt}</div>
          </div>
        </button>
        <div className="flex items-center gap-1.5 text-[10px]">
          {running > 0 && (
            <span className="text-blue-700 dark:text-blue-300">{running} running</span>
          )}
          {completed > 0 && (
            <span className="text-emerald-700 dark:text-emerald-300">{completed} done</span>
          )}
          {(errored > 0 || timedOut > 0) && (
            <span className="text-destructive">{errored + timedOut} failed</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => removeSession(session.parentCallId)}
          title="Dismiss"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {!session.collapsed && (
        <div className="space-y-1 border-t px-2 py-1.5">
          {subs.length === 0 ? (
            <div className="text-[11px] text-muted-foreground italic">spinning up sub-runs…</div>
          ) : (
            subs.map((sub) => <SubRunRow key={sub.runId} sub={sub} />)
          )}
        </div>
      )}
    </div>
  );
}

export function ParallelRunsPanel() {
  // NOTE: useParallelEventBridge is mounted ONCE at the App root — mounting
  // it here too registered a second onMessage listener and every sub-run
  // chunk rendered twice ("hellohello worldworld") with doubled data-event
  // counts.
  const sessions = useParallelRunsStore((s) => s.sessions);
  const sessionList = Object.values(sessions).sort((a, b) => b.startedAt - a.startedAt);
  if (sessionList.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Parallel runs
      </div>
      {sessionList.map((s) => (
        <SessionCard key={s.parentCallId} session={s} />
      ))}
    </div>
  );
}
