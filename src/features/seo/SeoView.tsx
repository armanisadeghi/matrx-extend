import { CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { AiRecommendations } from '@/features/seo/AiRecommendations';
import { SeoDetails } from '@/features/seo/SeoDetails';
import { useActiveTab } from '@/hooks/use-active-tab';
import { stringifyJson, wrapForAgent } from '@/lib/clipboard/copy';
import { captureWithFallback } from '@/lib/scrape/capture-with-fallback';
import type { SeoAudit } from '@/lib/seo/audit';
import {
  type SeoDiff,
  type SeoDiffEntry,
  type StoredAuditSignals,
  diffSeoAudits,
  parseStoredSignals,
  summarizeDiff,
  toStoredSignals,
} from '@/lib/seo/diff';
import { evaluateSeoAudit } from '@/lib/seo/evaluators/from-audit';
import { seoAuditToText } from '@/lib/seo/to-text';
import { SeoVerdict } from '@/features/seo/SeoVerdict';
import { type SeoAuditRow, fetchSeoAuditHistoryForUrl, saveSeoAudit } from '@/lib/supabase/queries';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  History,
  Loader2,
  Minus,
  Save,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

/** A saved row plus its parsed signals + the verdict vs the row before it. */
interface HistoryEntry {
  row: SeoAuditRow;
  signals: StoredAuditSignals | null;
  /** Diff against the NEXT OLDER saved audit; null for the oldest row. */
  diffVsPrevious: SeoDiff | null;
}

export function SeoView() {
  const tab = useActiveTab();
  const [audit, setAudit] = useState<SeoAudit | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [history, setHistory] = useState<SeoAuditRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  /** When set, the body renders that saved snapshot instead of the live audit. */
  const [viewingId, setViewingId] = useState<string | null>(null);
  /**
   * Tracks the URL we've already auto-run an audit for, so opening the SEO
   * tab fires once per page (and re-fires on navigation) but doesn't loop
   * after the audit state updates. Manual "Re-audit" is unrelated — it
   * always runs on click.
   */
  const lastAutoRunUrlRef = useRef<string | null>(null);

  const reloadHistory = async (url: string) => {
    const rows = await fetchSeoAuditHistoryForUrl(url);
    setHistory(rows);
  };

  useEffect(() => {
    if (!tab.url) {
      setHistory([]);
      setViewingId(null);
      return;
    }
    let cancelled = false;
    const url = tab.url;
    void (async () => {
      const rows = await fetchSeoAuditHistoryForUrl(url);
      if (cancelled) return;
      setHistory(rows);
      setViewingId(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.url]);

  // Auto-run an audit when the SEO tab gets a fresh URL — first mount, or
  // user navigates the active tab. Manual "Re-audit" stays as the way to
  // refresh against the same URL. Errors are already caught + logged inside
  // runAudit, so a restricted page (chrome://) just no-ops gracefully.
  useEffect(() => {
    if (!tab.id || !tab.url) return;
    if (lastAutoRunUrlRef.current === tab.url) return;
    lastAutoRunUrlRef.current = tab.url;
    void runAudit();
    // runAudit is defined in the component body and reads the latest tab
    // state via closure; we only want this effect to fire on URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.url]);

  const [auditError, setAuditError] = useState<string | null>(null);
  // Live tab snapshot for the out-of-order guard above.
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const runAudit = async () => {
    if (!tab.id) return;
    setRunning(true);
    setSavedId(null);
    setAuditError(null);
    setViewingId(null);
    const requestedTab = tab.id;
    const requestedUrl = tab.url;
    try {
      // ONE code path: the content script's full collector (lib/seo/audit)
      // via the shared capture primitive. The previous hand-rolled inline
      // func HARDCODED links {internal:0, external:0}, empty schema_types/
      // hreflang, and flesch_reading_ease null — Copy presented those as
      // real measurements and Save persisted them to wbx_seo_audit.
      const cap = await captureWithFallback(requestedTab, requestedUrl ?? null);
      // Out-of-order / navigation guard: a slow audit of page A must not
      // overwrite page B's fresh state.
      if (tabRef.current.id !== requestedTab || tabRef.current.url !== requestedUrl) return;
      if (!cap.ok || !cap.soup) {
        setAudit(null);
        setAuditError(
          cap.reason === 'unreachable-url'
            ? 'This page cannot be audited (browser-internal or restricted URL).'
            : `Audit failed: ${cap.detail ?? cap.reason ?? 'unknown error'}`,
        );
        return;
      }
      setAudit(cap.soup.seo);
    } catch (err) {
      setAudit(null);
      setAuditError(`Audit failed: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    if (!audit) return;
    setSaving(true);
    const r = await saveSeoAudit({
      url: audit.url,
      signals: audit,
      flesch_reading_ease: audit.flesch_reading_ease,
      word_count: audit.word_count,
    });
    setSaving(false);
    if (r) {
      setSavedId(r.id);
      // The saved row IS the new baseline — reload so the diff compares
      // against what was just persisted, not the run before it.
      await reloadHistory(audit.url);
    } else {
      setAuditError('Save failed — check your connection and sign-in, then try again.');
    }
  };

  /** History rows, each carrying its parsed signals + verdict vs the older one. */
  const entries: HistoryEntry[] = useMemo(() => {
    const parsed = history.map((row) => ({ row, signals: parseStoredSignals(row.signals) }));
    return parsed.map((p, i) => {
      const older = parsed[i + 1];
      return {
        ...p,
        diffVsPrevious:
          p.signals && older?.signals ? diffSeoAudits(older.signals, p.signals) : null,
      };
    });
  }, [history]);

  const latestSaved = entries[0];
  const viewing = viewingId ? entries.find((e) => e.row.id === viewingId) : undefined;

  /** Live audit vs the most recent SAVED audit — the "did my change help?" answer. */
  const liveDiff = useMemo(() => {
    if (!audit || !latestSaved?.signals) return null;
    return diffSeoAudits(latestSaved.signals, toStoredSignals(audit));
  }, [audit, latestSaved]);

  const bodySignals: StoredAuditSignals | null = viewing
    ? viewing.signals
    : audit
      ? toStoredSignals(audit)
      : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        <span className="shrink-0 text-sm font-medium">SEO audit</span>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary/60"
            title="Saved audits for this URL"
          >
            <History className="size-3 shrink-0" />
            <span className="tabular-nums">{history.length}</span>
            <ChevronDown
              className={`size-3 shrink-0 transition-transform ${showHistory ? 'rotate-180' : ''}`}
            />
          </button>
        )}
        {bodySignals && (
          <div className="ml-auto shrink-0">
            <CopyMenu
              title="Copy audit"
              options={[
                {
                  label: 'Summary (text)',
                  getContent: () => seoAuditToText(bodySignals),
                },
                {
                  label: 'For AI agent',
                  ai: true,
                  getContent: () =>
                    wrapForAgent({
                      description: 'an SEO audit for a webpage',
                      source: { url: bodySignals.url ?? '', title: bodySignals.title?.value ?? '' },
                      format: 'text',
                      content: seoAuditToText(bodySignals),
                    }),
                },
                {
                  label: 'JSON',
                  adminOnly: true,
                  getContent: () =>
                    stringifyJson(viewing ? viewing.row.signals : (audit ?? bodySignals)),
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 px-3 pb-3">
          {showHistory && (
            <HistoryList
              entries={entries}
              viewingId={viewingId}
              onOpen={(id) => {
                setViewingId(id);
                setShowHistory(false);
              }}
            />
          )}

          {viewing && (
            <div className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="font-medium">Saved snapshot</div>
                <div className="truncate text-muted-foreground">
                  {new Date(viewing.row.audited_at).toLocaleString()}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 rounded-full px-2 text-xs"
                onClick={() => setViewingId(null)}
              >
                <ArrowLeft className="size-3" />
                Live
              </Button>
            </div>
          )}

          {viewing?.diffVsPrevious && (
            <DiffCard
              diff={viewing.diffVsPrevious}
              heading="Changes in this snapshot"
              since="the audit saved before it"
            />
          )}

          {!viewing && liveDiff && latestSaved && (
            <DiffCard
              diff={liveDiff}
              heading="Since your last saved audit"
              since={new Date(latestSaved.row.audited_at).toLocaleString()}
            />
          )}

          {!bodySignals ? (
            <div className="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground">
              Run an audit to see metadata, headings, images, and AI recommendations.
            </div>
          ) : (
            <AuditBody signals={bodySignals} liveAudit={viewing ? null : audit} />
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 px-3 pb-3 pt-1">
        <Button onClick={() => void runAudit()} disabled={running} className="flex-1 rounded-full">
          {running ? <Loader2 className="animate-spin" /> : <Search />}
          {audit ? 'Re-audit' : 'Audit this page'}
        </Button>
        {audit && !viewing && (
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            variant="secondary"
            className="rounded-full"
          >
            {saving ? <Loader2 className="animate-spin" /> : savedId ? <CheckCircle2 /> : <Save />}
            {savedId ? 'Saved' : 'Save'}
          </Button>
        )}
      </div>
      {auditError && (
        <div className="px-3 pb-2 text-[11px] text-red-600 dark:text-red-400">{auditError}</div>
      )}
    </div>
  );
}

/* ── diff ────────────────────────────────────────────────────────────────── */

/**
 * The verdict card. Renders ONLY what changed — unchanged fields collapse into
 * a single trailing line, because a list of twenty "unchanged" rows is exactly
 * as useless as the bare timestamp this replaced.
 */
function DiffCard({ diff, heading, since }: { diff: SeoDiff; heading: string; since: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/25 p-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className="min-w-0 truncate">{heading}</span>
        {!diff.identical && (
          <span className="shrink-0 normal-case tracking-normal">{summarizeDiff(diff)}</span>
        )}
      </div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground">vs {since}</div>

      {diff.identical ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-foreground">
          <Minus className="size-3.5 shrink-0 text-muted-foreground" />
          Nothing changed — this page is identical to the saved audit.
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {diff.entries.map((e) => (
            <DiffRow key={e.key} entry={e} />
          ))}
        </div>
      )}

      {diff.unchanged.length > 0 && (
        <div className="mt-2 border-t border-border/50 pt-1.5 text-[10px] text-muted-foreground">
          Unchanged: {diff.unchanged.join(' · ')}
        </div>
      )}
    </div>
  );
}

function DiffRow({ entry }: { entry: SeoDiffEntry }) {
  const tone =
    entry.direction === 'better'
      ? 'text-emerald-600 dark:text-emerald-400'
      : entry.direction === 'worse'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground';
  const Icon =
    entry.direction === 'better' ? TrendingUp : entry.direction === 'worse' ? TrendingDown : Minus;
  return (
    <div className="flex gap-1.5 text-xs">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="break-words text-foreground">{entry.verdict}</div>
        {(entry.before !== undefined || entry.after !== undefined) && (
          <div className="mt-0.5 space-y-0.5 text-[11px]">
            <div className="break-words text-muted-foreground line-through decoration-muted-foreground/50">
              {entry.before}
            </div>
            <div className="break-words text-foreground/90">{entry.after}</div>
          </div>
        )}
        {entry.items && entry.items.length > 0 && (
          <div className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
            {entry.items.map((it) => (
              <div key={it} className="break-words">
                {it}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── history ─────────────────────────────────────────────────────────────── */

function HistoryList({
  entries,
  viewingId,
  onOpen,
}: {
  entries: HistoryEntry[];
  viewingId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Saved audits for this URL
      </div>
      {entries.map((e) => (
        <button
          key={e.row.id}
          type="button"
          onClick={() => onOpen(e.row.id)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-secondary/60 ${
            viewingId === e.row.id ? 'bg-secondary/60' : ''
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-foreground">
              {new Date(e.row.audited_at).toLocaleString()}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {e.diffVsPrevious ? summarizeDiff(e.diffVsPrevious) : 'First saved audit'}
              {e.signals?.word_count !== null && e.signals?.word_count !== undefined
                ? ` · ${e.signals.word_count.toLocaleString()} words`
                : ''}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── audit body ──────────────────────────────────────────────────────────── */

/**
 * One render path for the live audit AND for a saved snapshot — a stored row's
 * `signals` is the same shape, so browsing history reuses this rather than
 * growing a second, dumber viewer.
 */
function AuditBody({
  signals,
  liveAudit,
}: {
  signals: StoredAuditSignals;
  /** The live audit object, or null when viewing a saved snapshot. */
  liveAudit: SeoAudit | null;
}) {
  return (
    <>
      {/* The verdict comes FIRST — the sections below say what is ON the page,
          this says whether any of it is good or bad and what to do about it.
          Live audits only: `evaluateSeoAudit` takes a whole `SeoAudit`, and a
          saved row parses to the narrower `StoredAuditSignals`. Running it on
          a partial snapshot would report problems the page may not have, so it
          doesn't run at all rather than run on faked inputs. */}
      {liveAudit && <SeoVerdict audit={liveAudit} evaluation={evaluateSeoAudit(liveAudit)} />}

      {/* Every value the audit collected, grouped by what the user is actually
          asking. Shared with the Scrape tab's SEO panel — see SeoDetails for
          why this is one component and not two. */}
      <SeoDetails signals={signals} />

      {/* Live audits only — a saved snapshot's numbers are history, and the
          agent would be reasoning about a page that may no longer look like
          that. Keyed so a navigation / Re-audit drops stale advice. */}
      {liveAudit && (
        <AiRecommendations key={`${liveAudit.url}:${liveAudit.fetched_at}`} audit={liveAudit} />
      )}
    </>
  );
}
