import { Button } from '@/components/ui/button';
import { useActiveTab } from '@/hooks/use-active-tab';
import { runPattern } from '@/lib/data-pattern/run-pattern';
import {
  type ExtractionPattern,
  bumpPatternRun,
  fetchPatternsForDomain,
} from '@/lib/supabase/queries';
import { cn } from '@/lib/utils';
import { CheckCircle2, Loader2, PlayCircle, RefreshCw, XCircle } from 'lucide-react';
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
};

export function PatternsTab() {
  const tab = useActiveTab();
  const [patterns, setPatterns] = useState<ExtractionPattern[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
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
    try {
      setPatterns(await fetchPatternsForDomain(host));
    } finally {
      setLoading(false);
    }
  }, [host]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRun = async (p: ExtractionPattern) => {
    if (!tab.id) return;
    setRunningId(p.id);
    setActiveName(p.name);
    setRows(null);
    try {
      const data = await runPattern(p, tab.id);
      setRows(data);
      void bumpPatternRun(p.id, 'ok', data.length);
    } catch (err) {
      console.warn('[matrx-extend] pattern run failed', err);
      void bumpPatternRun(p.id, 'broken', 0);
    } finally {
      setRunningId(null);
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
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </Button>
        </div>

        {patterns && patterns.length === 0 && (
          <div className="grid place-items-center rounded-xl bg-secondary/40 px-4 py-8 text-center text-sm text-muted-foreground">
            No saved patterns for this host yet. Save one from any tab.
          </div>
        )}

        {patterns && patterns.length > 0 && (
          <div className="space-y-1.5">
            {patterns.map((p) => (
              <div
                key={p.id}
                className="space-y-1.5 rounded-xl bg-secondary/40 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      <KindBadge kind={p.kind} />
                      <StatusBadge status={p.last_status} />
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.fields.length > 0 && `${p.fields.length} field${p.fields.length === 1 ? '' : 's'} · `}
                      {p.last_run_at
                        ? `last run ${formatRelative(p.last_run_at)}`
                        : 'never run'}
                      {p.last_run_count != null && ` · ${p.last_run_count} rows`}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleRun(p)}
                    disabled={runningId === p.id || !tab.id}
                    className="size-7 shrink-0"
                  >
                    {runningId === p.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <PlayCircle className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
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
        status === 'ok' &&
          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
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
