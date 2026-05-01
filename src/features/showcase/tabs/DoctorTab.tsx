import { CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { useActiveTab } from '@/hooks/use-active-tab';
import { stringifyJson, wrapJsonForAgent } from '@/lib/clipboard/copy';
import {
  type PageDiagnostic,
  pageDiagnosticInPage,
} from '@/lib/data-pattern/page-diagnostic';
import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  Loader2,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const MODE_LABELS: Record<string, string> = {
  json_ld: 'JSON-LD tab',
  microdata: 'Microdata tab',
  next_data: 'Framework tab',
  auto_table: 'Tables tab',
  list_pattern: 'List Pattern tab',
  ai_extract: 'AI Extract tab',
  network_capture: 'Network tab',
  og_meta: 'Snapshot tab',
};

export function DoctorTab() {
  const tab = useActiveTab();
  const [diag, setDiag] = useState<PageDiagnostic | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!tab.id) return;
    setRunning(true);
    setError(null);
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: pageDiagnosticInPage,
      });
      const r = result?.[0]?.result as PageDiagnostic | undefined;
      if (!r) {
        setError('No result from page probe.');
      } else {
        setDiag(r);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [tab.id]);

  useEffect(() => {
    if (tab.id) void run();
  }, [run, tab.id, tab.url]);

  const copyOptions = useMemo(() => {
    if (!diag) return [];
    return [
      {
        label: 'Copy diagnostic JSON',
        description: 'Raw probe result. Includes URL, signal counts, recommendations.',
        getContent: () => stringifyJson(diag),
      },
      {
        label: 'Copy for AI',
        description:
          'Wrapped with a one-line preamble + source URL. Paste into chat with an agent.',
        ai: true,
        getContent: () =>
          wrapJsonForAgent(diag, {
            description:
              'a page-diagnostic snapshot from the matrx-extend Chrome extension. It lists every structured-data signal we detected on the active page (JSON-LD, microdata, framework state, tables, inline window.* assignments) plus our recommendations for which extraction mode is most likely to work',
            source: { url: tab.url, title: tab.title },
            followUp:
              'Tell me which extraction approach is most likely to work, and if applicable, what selectors / key paths / regexes I should configure.',
          }),
      },
    ];
  }, [diag, tab.url, tab.title]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Doctor
            </div>
            <div className="text-xs text-muted-foreground">
              Probes the page for every structured-data signal we know how to read. Tells you
              which tab is most likely to extract something useful — or hand the diagnostic to
              an AI when nothing's working.
            </div>
          </div>
          <Button
            onClick={() => void run()}
            disabled={running}
            size="sm"
            variant="secondary"
            className="shrink-0 rounded-full"
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Stethoscope className="size-3.5" />}
            {running ? 'Probing…' : 'Re-probe'}
          </Button>
        </div>

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {diag && (
          <>
            <div className="space-y-1.5 rounded-xl bg-secondary/40 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Recommendations
                </span>
                <CopyMenu options={copyOptions} title="Copy diagnostic" size="sm" />
              </div>
              {diag.recommendations.length === 0 ? (
                <div className="text-muted-foreground">No recommendations.</div>
              ) : (
                <div className="space-y-1">
                  {diag.recommendations.map((r, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: render-only.
                      key={i}
                      className="flex items-start gap-2 rounded-lg bg-background/60 px-2 py-1.5"
                    >
                      <span className="mt-0.5 rounded-full bg-primary/15 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-primary">
                        {MODE_LABELS[r.mode] ?? r.mode}
                      </span>
                      <span className="text-[11px]">{r.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5 rounded-xl bg-secondary/40 p-3 text-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Page signals
              </div>
              <SignalRow
                label="JSON-LD"
                ok={diag.sources.json_ld.count > 0}
                detail={
                  diag.sources.json_ld.count > 0
                    ? `${diag.sources.json_ld.count} block${diag.sources.json_ld.count === 1 ? '' : 's'} · types: ${diag.sources.json_ld.types.join(', ') || '—'}`
                    : 'none'
                }
              />
              <SignalRow
                label="Microdata"
                ok={diag.sources.microdata.count > 0}
                detail={
                  diag.sources.microdata.count > 0
                    ? `${diag.sources.microdata.count} item${diag.sources.microdata.count === 1 ? '' : 's'} · ${diag.sources.microdata.types.join(', ')}`
                    : 'none'
                }
              />
              <SignalRow
                label="Tables"
                ok={diag.sources.tables.usable_count > 0}
                detail={
                  diag.sources.tables.usable_count > 0
                    ? `${diag.sources.tables.usable_count} usable / ${diag.sources.tables.count} total`
                    : 'none'
                }
              />
              <SignalRow
                label="__NEXT_DATA__"
                ok={diag.sources.next_data.present}
                detail={
                  diag.sources.next_data.present
                    ? `${(diag.sources.next_data.size_bytes / 1024).toFixed(1)} KB`
                    : 'absent'
                }
              />
              <SignalRow
                label="__NUXT_DATA__"
                ok={diag.sources.nuxt_data.present}
                detail={
                  diag.sources.nuxt_data.present
                    ? `${(diag.sources.nuxt_data.size_bytes / 1024).toFixed(1)} KB`
                    : 'absent'
                }
              />
              <SignalRow
                label="Apollo (DOM)"
                ok={diag.sources.apollo_dom.present}
                detail={
                  diag.sources.apollo_dom.present
                    ? `${(diag.sources.apollo_dom.size_bytes / 1024).toFixed(1)} KB`
                    : 'absent'
                }
              />
              <SignalRow
                label="Apollo (inline)"
                ok={diag.sources.apollo_inline.present}
                detail={diag.sources.apollo_inline.present ? 'detected' : 'absent'}
              />
              <SignalRow
                label="bpr-guid (LinkedIn)"
                ok={diag.sources.bpr_guid.count > 0}
                detail={
                  diag.sources.bpr_guid.count > 0
                    ? `${diag.sources.bpr_guid.count} block(s) · ${(diag.sources.bpr_guid.total_size_bytes / 1024).toFixed(1)} KB`
                    : 'absent'
                }
              />
              <SignalRow
                label="Inline window.* state"
                ok={diag.sources.window_assignments.length > 0}
                detail={
                  diag.sources.window_assignments.length > 0
                    ? diag.sources.window_assignments
                        .map((a) => `${a.name} (~${(a.size_bytes / 1024).toFixed(1)} KB)`)
                        .join(', ')
                    : 'absent'
                }
              />
            </div>

            <div className="space-y-1.5 rounded-xl bg-secondary/40 p-3 text-xs">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Page basics
              </div>
              <KV label="Host" value={diag.host} />
              <KV label="Title" value={diag.title || '—'} />
              <KV label="Lang" value={diag.lang ?? '—'} />
              <KV label="Meta tags" value={String(diag.meta_count)} />
              <KV
                label="Body text"
                value={`${(diag.body_total_bytes / 1024).toFixed(1)} KB`}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignalRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {ok ? (
        <CheckCircle2 className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <XCircle className="size-3 shrink-0 text-muted-foreground/50" />
      )}
      <span className={cn('w-32 shrink-0 font-medium', !ok && 'text-muted-foreground')}>
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail}</span>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono">{value}</span>
    </div>
  );
}
