import { CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActiveTab } from '@/hooks/use-active-tab';
import { useAuth } from '@/hooks/use-auth';
import { rowsToTsv, stringifyJson, wrapForAgent, wrapJsonForAgent } from '@/lib/clipboard/copy';
import { findFirstMatch } from '@/lib/data-pattern/matcher';
import { NetworkNoMatchError, runSavedPattern } from '@/lib/data-pattern/run-interactive';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  type ExtractionPattern,
  bumpPatternRun,
  fetchPatternsForDomain,
  savePattern,
} from '@/lib/supabase/queries';
import { useAutoExtractStore } from '@/state/auto-extract';
import { useHighlightStore } from '@/state/highlights';
import { Crosshair, Loader2, LogIn, Play, Save, XCircle, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export function DataView() {
  const { user, status: authStatus, signIn } = useAuth();
  const tab = useActiveTab();
  const [patterns, setPatterns] = useState<ExtractionPattern[] | null>(null);
  const [picking, setPicking] = useState(false);
  const pickTabRef = useRef<number | null>(null);
  const [pickedFields, setPickedFields] = useState<{ name: string; selector: string }[]>([]);
  const [patternName, setPatternName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);

  // Navigating the tab orphans any extracted rows on screen — they belonged
  // to the previous page and rendered with zero indication of that.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on URL change only
  useEffect(() => {
    setRows(null);
    setRunNote(null);
  }, [tab.url]);

  const host = (() => {
    try {
      return tab.url ? new URL(tab.url).host : '';
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await fetchPatternsForDomain(host);
        if (!cancelled) setPatterns(p);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [host]);

  useEffect(() => {
    // STRICT: only the SW's stamped rebroadcast counts. The raw content-
    // script delivery (tab_id absent) reaches every sidepanel directly —
    // accepting it processed each pick TWICE and let window A's pick land
    // in window B's builder.
    const fromOurPick = (tabId: unknown) =>
      typeof tabId === 'number' && tabId === pickTabRef.current;
    const offResult = on<
      { fields?: { name: string; selector: string }[]; tab_id?: number | null },
      { ack: true }
    >(CHANNELS.DATA_PICKER_RESULT, (payload) => {
      if (!fromOurPick(payload?.tab_id)) return { ack: true };
      setPicking(false);
      setPickedFields(payload.fields ?? []);
      return { ack: true };
    });
    const offExit = on<{ tab_id?: number | null }, { ack: true }>(
      CHANNELS.DATA_PICKER_EXIT,
      (payload) => {
        if (!fromOurPick(payload?.tab_id)) return { ack: true };
        setPicking(false);
        return { ack: true };
      },
    );
    return () => {
      offResult();
      offExit();
    };
  }, []);

  // Handoff from the Highlight tab: element highlights → picker fields. The
  // Highlight tab stashes them in the shared store and switches to this tab;
  // we consume + clear so re-visits don't re-load stale fields.
  const dataHandoff = useHighlightStore((s) => s.dataHandoff);
  const setDataHandoff = useHighlightStore((s) => s.setDataHandoff);
  useEffect(() => {
    if (dataHandoff && dataHandoff.length > 0) {
      setPickedFields(dataHandoff);
      setDataHandoff(null);
    }
  }, [dataHandoff, setDataHandoff]);

  const enterPicker = async () => {
    if (!tab.id || picking) return;
    setPicking(true);
    setPickedFields([]);
    pickTabRef.current = tab.id;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/data-picker.js'],
      });
    } catch (err) {
      setPicking(false);
      console.warn('[matrx-extend] picker injection failed', err);
    }
  };

  const handleSavePattern = async () => {
    if (!host || pickedFields.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const r = await savePattern({
        name: patternName || `${host} pattern`,
        domain: host,
        route_pattern: tab.url ? new URL(tab.url).pathname : null,
        list_root_selector: null,
        kind: 'manual_css',
        config: {},
        fields: pickedFields.map((f) => ({
          name: f.name,
          selector: f.selector,
          is_list: false,
        })),
      });
      if (!r) {
        setError('Failed to save pattern. Check your connection and try again.');
        return;
      }
      setPatternName('');
      setPickedFields([]);
      setPatterns(await fetchPatternsForDomain(host));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async (pattern: ExtractionPattern) => {
    if (!tab.id) return;
    setRunning(true);
    setError(null);
    // A failed run used to leave the PREVIOUS run's rows rendered under the
    // error — clear up front so what's on screen always belongs to this run.
    setRows(null);
    setRunNote(null);
    try {
      const data = await runSavedPattern(pattern, tab.id, { onProgress: setRunNote });
      setRows(data);
      void bumpPatternRun(pattern.id, 'ok', data.length);
    } catch (err) {
      if (err instanceof NetworkNoMatchError) {
        setError(err.message);
      } else {
        setError(`"${pattern.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
        void bumpPatternRun(pattern.id, 'broken', 0);
      }
    } finally {
      setRunning(false);
      setRunNote(null);
    }
  };

  const matched = patterns ? findFirstMatch(tab.url ?? '', patterns) : null;
  const hasFields = pickedFields.length > 0;

  // Auto-extract: pick up records the global useAutoExtract() hook (mounted
  // in App.tsx) populated for the current URL. Display rows automatically
  // without requiring the user to click Run.
  const autoRecords = useAutoExtractStore((s) => s.records);
  const autoForUrl = useMemo(() => {
    const url = tab.url;
    if (!url) return [];
    return Array.from(autoRecords.values()).filter((r) => r.url === url);
  }, [autoRecords, tab.url]);
  const autoForMatched = matched ? autoForUrl.find((r) => r.pattern.id === matched.id) : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Structured data</span>
        <span className="ml-2 truncate text-xs text-muted-foreground">{host || 'no host'}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 px-3 pb-3">
          {error && (
            <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {running && runNote && (
            <div className="flex items-center gap-1.5 rounded-xl bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {runNote}
            </div>
          )}

          {matched && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5">
              <div className="min-w-0 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-emerald-700 dark:text-emerald-300">
                    {matched.name}
                  </span>
                  {autoForMatched?.status === 'running' && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      <Loader2 className="size-2.5 animate-spin" />
                      auto
                    </span>
                  )}
                  {autoForMatched?.status === 'ok' && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                      <Zap className="size-2.5" />
                      auto · {autoForMatched.rows.length} rows
                    </span>
                  )}
                  {autoForMatched?.status === 'error' && (
                    <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-red-700 dark:text-red-400">
                      <XCircle className="size-2.5" />
                      auto failed
                    </span>
                  )}
                </div>
                <div className="text-emerald-700/70 dark:text-emerald-300/70">
                  {autoForMatched?.status === 'ok'
                    ? 'Auto-extracted on page load — no click needed.'
                    : autoForMatched?.status === 'error'
                      ? (autoForMatched.error ?? 'Auto-extract failed')
                      : 'Matches this URL'}
                </div>
              </div>
              <Button
                size="sm"
                className="h-7 shrink-0 rounded-full px-3 text-xs"
                onClick={() => void handleRun(matched)}
                disabled={running}
              >
                {running ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {autoForMatched?.status === 'ok' ? 'Re-run' : 'Extract'}
              </Button>
            </div>
          )}

          {autoForMatched?.status === 'ok' && autoForMatched.rows.length > 0 && !rows && (
            <Section label={`Auto-extracted (${autoForMatched.rows.length} rows)`}>
              <pre className="max-h-[320px] overflow-auto whitespace-pre rounded-xl bg-secondary/40 p-3 text-[11px]">
                {JSON.stringify(autoForMatched.rows.slice(0, 50), null, 2)}
                {autoForMatched.rows.length > 50 &&
                  `\n\n…(+${autoForMatched.rows.length - 50} more rows)`}
              </pre>
            </Section>
          )}

          {hasFields && (
            <Section
              label={`${pickedFields.length} field${pickedFields.length === 1 ? '' : 's'} selected`}
            >
              <div className="space-y-1">
                {pickedFields.map((f, i) => (
                  <div
                    key={`${f.selector}-${i}`}
                    className="truncate rounded-lg bg-secondary/40 px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    <span className="text-muted-foreground">{f.name}:</span> {f.selector}
                  </div>
                ))}
              </div>
              {user ? (
                <Input
                  value={patternName}
                  onChange={(e) => setPatternName(e.target.value)}
                  placeholder="Pattern name…"
                  className="rounded-full border-0 bg-secondary/40 focus-visible:ring-1"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Field selection works as a guest. Sign in to save and reuse this pattern.
                </p>
              )}
            </Section>
          )}

          {patterns && patterns.length > 0 && (
            <Section label={`Saved for ${host}`}>
              <div className="space-y-1">
                {patterns.map((p) => (
                  <div
                    key={p.id}
                    className="group flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-2"
                  >
                    <div className="min-w-0 text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{p.name}</span>
                        <PatternBadges kind={p.kind} status={p.last_status} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.fields.length} field{p.fields.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <CopyMenu
                        title="Copy pattern"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        options={[
                          {
                            label: 'Selectors (text)',
                            getContent: () =>
                              p.fields.map((f) => `${f.name}: ${f.selector}`).join('\n'),
                          },
                          {
                            label: 'For AI agent',
                            ai: true,
                            getContent: () =>
                              wrapJsonForAgent(p, {
                                description: 'a saved Matrx data-extraction pattern',
                                source: { host: p.domain ?? null },
                                meta: {
                                  patternName: p.name,
                                  fieldCount: p.fields.length,
                                },
                              }),
                          },
                          {
                            label: 'Full pattern (JSON)',
                            adminOnly: true,
                            getContent: () => stringifyJson(p),
                          },
                        ]}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() => void handleRun(p)}
                        disabled={running}
                        title="Run pattern"
                      >
                        <Play className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {rows && (
            <Section
              label={`Extracted rows (${rows.length})`}
              rightSlot={
                <CopyMenu
                  title="Copy rows"
                  options={[
                    {
                      label: 'TSV (paste to spreadsheet)',
                      description: 'Tab-separated rows',
                      getContent: () => rowsToTsv(rows),
                    },
                    {
                      label: 'JSON',
                      getContent: () => stringifyJson(rows),
                    },
                    {
                      label: 'For AI agent',
                      ai: true,
                      getContent: () =>
                        wrapForAgent({
                          description:
                            'structured data extracted from a webpage using a saved pattern',
                          source: {
                            url: tab.url ?? null,
                            host,
                            title: tab.title ?? null,
                          },
                          meta: {
                            rowCount: rows.length,
                            patternMatched: matched?.name ?? null,
                          },
                          format: 'json',
                          content: stringifyJson(rows),
                        }),
                    },
                  ]}
                />
              }
            >
              <pre className="max-h-[320px] overflow-auto whitespace-pre rounded-xl bg-secondary/40 p-3 text-[11px]">
                {JSON.stringify(rows, null, 2)}
              </pre>
            </Section>
          )}

          {!matched && !hasFields && !patterns?.length && (
            <div className="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground">
              Pick fields on this page to build a saveable extraction pattern.
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 px-3 pb-3 pt-1">
        {hasFields ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setPickedFields([])}
              className="rounded-full"
            >
              Cancel
            </Button>
            {user ? (
              <Button
                onClick={() => void handleSavePattern()}
                disabled={saving}
                className="flex-1 rounded-full"
              >
                {saving ? <Loader2 className="animate-spin" /> : <Save />}
                Save pattern
              </Button>
            ) : (
              <Button
                onClick={() => void signIn()}
                disabled={authStatus === 'signing-in'}
                className="flex-1 rounded-full"
              >
                {authStatus === 'signing-in' ? <Loader2 className="animate-spin" /> : <LogIn />}
                Sign in to save
              </Button>
            )}
          </>
        ) : (
          <Button
            onClick={() => void enterPicker()}
            disabled={picking || !tab.id}
            className="w-full rounded-full"
          >
            {picking ? <Loader2 className="animate-spin" /> : <Crosshair />}
            {picking ? 'Picking on page…' : 'Pick fields on this page'}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  rightSlot,
  children,
}: {
  label: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {rightSlot}
      </div>
      {children}
    </div>
  );
}

function PatternBadges({
  kind,
  status,
}: {
  kind: ExtractionPattern['kind'];
  status: ExtractionPattern['last_status'];
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {kind !== 'manual_css' && (
        <span className="rounded-full bg-secondary px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          {kind.replace('_', ' ')}
        </span>
      )}
      {status === 'broken' && (
        <span className="rounded-full bg-red-500/15 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-red-600 dark:text-red-400">
          broken
        </span>
      )}
    </span>
  );
}
