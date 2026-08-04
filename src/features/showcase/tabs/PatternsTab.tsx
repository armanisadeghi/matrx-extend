import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActiveTab } from '@/hooks/use-active-tab';
import { NetworkNoMatchError, runSavedPattern } from '@/lib/data-pattern/run-interactive';
import {
  type ExtractionPattern,
  bumpPatternRun,
  deletePattern,
  fetchPatternsForDomain,
  renamePattern,
} from '@/lib/supabase/queries';
import { cn } from '@/lib/utils';
import {
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  PlayCircle,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';

const KIND_LABELS: Record<string, string> = {
  manual_css: 'Manual',
  json_ld: 'JSON-LD',
  og_meta: 'Snapshot',
  auto_table: 'Table',
  next_data: 'Framework',
  ai_extract: 'AI',
  list_pattern: 'List',
  microdata: 'Microdata',
  network_capture: 'Network',
};

export function PatternsTab({ active = true }: { active?: boolean }) {
  const tab = useActiveTab();
  const [patterns, setPatterns] = useState<ExtractionPattern[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);

  const host = (() => {
    try {
      return tab.url ? new URL(tab.url).host : '';
    } catch {
      return '';
    }
  })();

  const refresh = useCallback(async () => {
    if (!host) return;
    setLoading(true);
    setLoadError(null);
    try {
      setPatterns(await fetchPatternsForDomain(host));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [host]);

  // Re-fetch whenever this tab becomes the visible one — picks up patterns
  // saved from sibling tabs without a manual refresh.
  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const handleRun = async (p: ExtractionPattern) => {
    if (!tab.id) return;
    setRunningId(p.id);
    setActiveName(p.name);
    setRows(null);
    setRunError(null);
    setRunNote(null);
    try {
      const data = await runSavedPattern(p, tab.id, { onProgress: setRunNote });
      setRows(data);
      void bumpPatternRun(p.id, 'ok', data.length);
    } catch (err) {
      if (err instanceof NetworkNoMatchError) {
        // Circumstantial — the page may just not have fired that API on
        // reload. Guidance only; don't mark the pattern broken.
        setRunError(err.message);
      } else {
        setRunError(`"${p.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
        void bumpPatternRun(p.id, 'broken', 0);
      }
    } finally {
      setRunningId(null);
      setRunNote(null);
      void refresh();
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Patterns
            </div>
            <div className="text-xs text-muted-foreground">
              All saved patterns for {host || 'this host'}, across every mode.
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void refresh()}
            className="size-7"
            title="Refresh"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
        </div>

        {loadError && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span className="min-w-0">{loadError}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void refresh()}
              className="h-6 shrink-0 rounded-full px-2 text-[11px]"
            >
              Retry
            </Button>
          </div>
        )}

        {runError && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {runError}
          </div>
        )}

        {!loadError && patterns && patterns.length === 0 && (
          <div className="grid place-items-center rounded-xl bg-secondary/40 px-4 py-8 text-center text-sm text-muted-foreground">
            No saved patterns for this host yet. Save one from any tab.
          </div>
        )}

        {patterns && patterns.length > 0 && (
          <div className="space-y-1.5">
            {patterns.map((p) => (
              <PatternRow
                key={p.id}
                pattern={p}
                running={runningId === p.id}
                runNote={runningId === p.id ? runNote : null}
                canRun={Boolean(tab.id)}
                onRun={() => void handleRun(p)}
                onChanged={() => void refresh()}
              />
            ))}
          </div>
        )}

        {rows && (
          <div className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Last run: {activeName ?? '—'}
            </div>
            <ResultPreview rows={rows} />
          </div>
        )}
      </div>
    </div>
  );
}

function PatternRow({
  pattern: p,
  running,
  runNote,
  canRun,
  onRun,
  onChanged,
}: {
  pattern: ExtractionPattern;
  running: boolean;
  runNote?: string | null;
  canRun: boolean;
  onRun: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(p.name);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // The two-step delete confirm disarms itself so a stray click later
  // doesn't delete.
  useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  const commitRename = async () => {
    if (draftName.trim() === p.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setRowError(null);
    const err = await renamePattern(p.id, draftName);
    setBusy(false);
    if (err) {
      setRowError(err);
      return;
    }
    setEditing(false);
    onChanged();
  };

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    setRowError(null);
    const ok = await deletePattern(p.id);
    setBusy(false);
    setConfirmingDelete(false);
    if (!ok) {
      setRowError('Delete failed. Check your connection and try again.');
      return;
    }
    onChanged();
  };

  return (
    <div className="group space-y-1.5 rounded-xl bg-secondary/40 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename();
                  if (e.key === 'Escape') {
                    setDraftName(p.name);
                    setEditing(false);
                    setRowError(null);
                  }
                }}
                autoFocus
                className="h-6 rounded-full bg-background px-2 text-xs"
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void commitRename()}
                disabled={busy}
                className="size-6 shrink-0"
                title="Save name"
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setDraftName(p.name);
                  setEditing(false);
                  setRowError(null);
                }}
                className="size-6 shrink-0"
                title="Cancel"
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{p.name}</span>
              <KindBadge kind={p.kind} />
              <StatusBadge status={p.last_status} />
            </div>
          )}
          <div className="text-[11px] text-muted-foreground">
            {p.fields.length > 0 &&
              `${p.fields.length} field${p.fields.length === 1 ? '' : 's'} · `}
            {p.last_run_at ? `last run ${formatRelative(p.last_run_at)}` : 'never run'}
            {p.last_run_count != null && ` · ${p.last_run_count} rows`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!editing && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setDraftName(p.name);
                  setEditing(true);
                  setConfirmingDelete(false);
                }}
                className="size-7 opacity-0 transition-opacity group-hover:opacity-100"
                title="Rename"
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void handleDelete()}
                disabled={busy}
                className={cn(
                  'size-7 transition-opacity',
                  confirmingDelete
                    ? 'bg-destructive/15 text-destructive opacity-100'
                    : 'opacity-0 group-hover:opacity-100',
                )}
                title={confirmingDelete ? 'Click again to delete permanently' : 'Delete pattern'}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={onRun}
            disabled={running || !canRun}
            title="Run pattern"
            className="size-7"
          >
            {running ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PlayCircle className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
      {running && runNote && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {runNote}
        </div>
      )}
      {rowError && <div className="text-[11px] text-destructive">{rowError}</div>}
    </div>
  );
}

function KindBadge({ kind }: { kind: ExtractionPattern['kind'] }) {
  return (
    <span className="rounded-full bg-secondary px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
      {KIND_LABELS[kind] ?? kind}
    </span>
  );
}

function StatusBadge({ status }: { status: ExtractionPattern['last_status'] }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-medium uppercase tracking-wider',
        status === 'ok' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        status === 'broken' && 'bg-red-500/15 text-red-600 dark:text-red-400',
        status === 'never_run' && 'bg-secondary text-muted-foreground',
      )}
    >
      {status === 'ok' && <CheckCircle2 className="size-2.5" />}
      {status === 'broken' && <XCircle className="size-2.5" />}
      {status === 'ok' ? 'ok' : status === 'broken' ? 'broken' : 'idle'}
    </span>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
