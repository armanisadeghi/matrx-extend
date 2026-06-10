import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActiveTab } from '@/hooks/use-active-tab';
import { type ExtractionSource, sourceFromUrl } from '@/hooks/use-extraction';
import { stringifyJson, wrapForAgent } from '@/lib/clipboard/copy';
import { type CandidateField, inspectCardInPage } from '@/lib/data-pattern/card-inspector';
import { probeFirstRowInPage } from '@/lib/data-pattern/modes/list-pattern';
import { runMode } from '@/lib/data-pattern/run-pattern';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Crosshair, Loader2, PlayCircle, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

interface FieldPath {
  name: string;
  rel_selector: string;
  attr?: string;
  transform?: { kind: 'regex'; expr: string };
}

interface ListPickerResult {
  list_root: string;
  item_selector: string;
  field_paths: FieldPath[];
}

const KIND_LABELS: Record<CandidateField['kind'], string> = {
  microdata: 'Microdata',
  'data-attr': 'Data attribute',
  link: 'Link',
  image: 'Image',
  time: 'Time',
  regex: 'Pattern',
  text: 'Text',
};

export function ListPatternTab() {
  const tab = useActiveTab();
  const [picking, setPicking] = useState(false);
  /** Tab the current pick session targets — events from other tabs are ignored. */
  const pickTabRef = useRef<number | null>(null);
  const [config, setConfig] = useState<ListPickerResult | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateField[] | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [sampleHtml, setSampleHtml] = useState<string[]>([]);
  const [expandedFieldIdx, setExpandedFieldIdx] = useState<number | null>(null);
  /** Live per-field sample values, probed using the SAME logic as the runner. */
  const [sampleValues, setSampleValues] = useState<Record<string, string | null>>({});
  const [source, setSource] = useState<ExtractionSource | null>(null);

  useEffect(() => {
    const fromOurPick = (tabId: unknown) =>
      tabId == null || pickTabRef.current == null || tabId === pickTabRef.current;
    const offResult = on<ListPickerResult & { tab_id?: number | null }, { ack: true }>(
      CHANNELS.LIST_PICKER_RESULT,
      (payload) => {
        if (!fromOurPick(payload?.tab_id)) return { ack: true };
        setPicking(false);
        if (payload?.list_root && payload.item_selector) {
          // Merge any newly-picked field_paths into existing config (so "Pick more
          // fields" appends rather than replaces).
          setConfig((prev) =>
            prev && prev.list_root === payload.list_root
              ? {
                  ...prev,
                  field_paths: [...prev.field_paths, ...payload.field_paths],
                }
              : payload,
          );
          setRows(null);
          setError(null);
        }
        return { ack: true };
      },
    );
    /**
     * Fires from the picker the MOMENT Phase 1 succeeds — before the user
     * clicks Done. Sets up the config with no fields so the Suggested Fields
     * panel populates immediately. The user can then add fields via one-click
     * suggestions OR keep clicking in the page; final Done merges both.
     */
    const offDetected = on<
      { list_root: string; item_selector: string; item_count: number },
      { ack: true }
    >(CHANNELS.LIST_PICKER_ITEM_DETECTED, (payload) => {
      if (!payload?.list_root || !payload.item_selector) return { ack: true };
      if (!fromOurPick((payload as { tab_id?: number | null }).tab_id)) return { ack: true };
      setConfig((prev) =>
        prev && prev.list_root === payload.list_root && prev.item_selector === payload.item_selector
          ? prev
          : {
              list_root: payload.list_root,
              item_selector: payload.item_selector,
              field_paths: prev?.field_paths ?? [],
            },
      );
      setRows(null);
      setError(null);
      return { ack: true };
    });
    const offExit = on<{ tab_id?: number | null }, { ack: true }>(
      CHANNELS.LIST_PICKER_EXIT,
      (payload) => {
        if (!fromOurPick(payload?.tab_id)) return { ack: true };
        setPicking(false);
        return { ack: true };
      },
    );
    return () => {
      offResult();
      offDetected();
      offExit();
    };
  }, []);

  // Auto-run card inspector whenever the item selector changes.
  const runInspector = useCallback(async () => {
    if (!tab.id || !config) return;
    setInspecting(true);
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: inspectCardInPage,
        args: [{ list_root: config.list_root, item_selector: config.item_selector }],
      });
      setCandidates((result?.[0]?.result as CandidateField[] | undefined) ?? []);
    } catch (err) {
      console.warn('[matrx-extend] card inspector failed', err);
      setCandidates([]);
    } finally {
      setInspecting(false);
    }
  }, [tab.id, config]);

  useEffect(() => {
    if (config?.list_root && config.item_selector) {
      void runInspector();
    } else {
      setCandidates(null);
    }
  }, [config?.list_root, config?.item_selector, runInspector]);

  /**
   * Probe live sample values for every selected field, using EXACTLY the
   * runner's extraction logic. Re-runs whenever fields change. Debounced so
   * inline edits don't fire a probe per keystroke.
   */
  useEffect(() => {
    if (!tab.id || !config || config.field_paths.length === 0) {
      setSampleValues({});
      return;
    }
    const tid = tab.id;
    const cfgSnapshot = config;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const result = await chrome.scripting.executeScript({
            target: { tabId: tid },
            func: probeFirstRowInPage,
            args: [cfgSnapshot],
          });
          const row = (result?.[0]?.result as Record<string, string | null> | null) ?? {};
          setSampleValues(row ?? {});
        } catch {
          setSampleValues({});
        }
      })();
    }, 300);
    return () => clearTimeout(handle);
  }, [tab.id, config]);

  // The content-script picker dies silently when the page navigates or the
  // tab closes — without this watcher, picking stays true forever (audit F1).
  useEffect(() => {
    if (!picking) return;
    const pickTab = pickTabRef.current;
    const onUpdated = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId !== pickTab) return;
      if (info.status === 'loading' || info.url) {
        setPicking(false);
        setError('The page navigated while picking — the picker closed. Pick again to continue.');
      }
    };
    const onRemoved = (tabId: number) => {
      if (tabId !== pickTab) return;
      setPicking(false);
      setError('The tab closed while picking.');
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [picking]);

  const enterPicker = async () => {
    if (!tab.id || picking) return;
    setPicking(true);
    setError(null);
    pickTabRef.current = tab.id;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-scripts/list-picker.js'],
      });
    } catch (err) {
      setPicking(false);
      setError(friendlyPickError(err));
    }
  };

  /** Sidepanel-side cancel — recovers a stuck pick without touching the page UI. */
  const cancelPicker = async () => {
    const tabId = pickTabRef.current;
    setPicking(false);
    if (!tabId) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          (window as { __matrxListPickerCancel?: () => void }).__matrxListPickerCancel?.();
        },
      });
    } catch {
      // Page may be gone — local state is already cleared.
    }
  };

  const captureSampleHtml = useCallback(async (): Promise<string[]> => {
    if (!tab.id || !config) return [];
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (cfg: { list_root: string; item_selector: string }) => {
          const root = document.querySelector(cfg.list_root);
          if (!root) return [];
          const items = Array.from(root.querySelectorAll(cfg.item_selector)).slice(0, 2);
          // Cap each sample to ~3KB so we don't blow out a clipboard paste.
          return items.map((it) => {
            const html = (it as HTMLElement).outerHTML ?? '';
            return html.length > 3000
              ? `${html.slice(0, 3000)}\n…(+${html.length - 3000} chars truncated)`
              : html;
          });
        },
        args: [{ list_root: config.list_root, item_selector: config.item_selector }],
      });
      return (result?.[0]?.result as string[] | undefined) ?? [];
    } catch {
      return [];
    }
  }, [tab.id, config]);

  const handleRun = async () => {
    if (!tab.id || !config) return;
    setRunning(true);
    setError(null);
    const sourceAtRun = sourceFromUrl(tab.url);
    try {
      const data = await runMode('list_pattern', tab.id, config);
      setRows(data);
      setSource(sourceAtRun);
      // Snapshot 1-2 cards' HTML for later AI-paste.
      const samples = await captureSampleHtml();
      setSampleHtml(samples);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const updateField = (i: number, patch: Partial<FieldPath>) => {
    if (!config) return;
    setConfig({
      ...config,
      field_paths: config.field_paths.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    });
  };

  const removeField = (i: number) => {
    if (!config) return;
    setConfig({
      ...config,
      field_paths: config.field_paths.filter((_, idx) => idx !== i),
    });
  };

  const addCandidate = (c: CandidateField) => {
    if (!config) return;
    setConfig({
      ...config,
      field_paths: [
        ...config.field_paths,
        {
          name: c.name,
          rel_selector: c.rel_selector,
          attr: c.attr,
          transform: c.transform,
        },
      ],
    });
  };

  const fields = config?.field_paths ?? [];
  const usedSelectors = useMemo(() => {
    const set = new Set<string>();
    for (const f of fields) set.add(`${f.rel_selector}|${f.attr ?? 'text'}`);
    return set;
  }, [fields]);

  const unusedCandidates = useMemo(() => {
    if (!candidates) return [];
    return candidates.filter((c) => !usedSelectors.has(`${c.rel_selector}|${c.attr ?? 'text'}`));
  }, [candidates, usedSelectors]);

  // ── Copy options for the pattern config + samples + rows ────────────────
  const patternCopyOptions = useMemo(() => {
    if (!config) return [];
    return [
      {
        label: 'Copy pattern config (JSON)',
        description: 'Just the pattern: list_root, item_selector, field_paths.',
        getContent: () => stringifyJson(config),
      },
      {
        label: 'Copy for AI (full debug bundle)',
        description:
          'Pattern + sample HTML + extracted rows + a one-line ask. Paste to an agent for refinement.',
        ai: true,
        getContent: async () => {
          // Capture fresh samples if we don't have them yet.
          let samples = sampleHtml;
          if (samples.length === 0) samples = await captureSampleHtml();

          const sections: string[] = [];
          sections.push('## Pattern config');
          sections.push('```json');
          sections.push(stringifyJson(config));
          sections.push('```');
          if (samples.length > 0) {
            sections.push('');
            sections.push('## Sample HTML');
            for (let i = 0; i < samples.length; i++) {
              sections.push(`### Sample ${i + 1}`);
              sections.push('```html');
              sections.push(samples[i] ?? '');
              sections.push('```');
            }
          }
          if (rows && rows.length > 0) {
            sections.push('');
            sections.push(`## Extracted rows (showing first 5 of ${rows.length})`);
            sections.push('```json');
            sections.push(stringifyJson(rows.slice(0, 5)));
            sections.push('```');
          }
          if (candidates && candidates.length > 0) {
            sections.push('');
            sections.push('## Detected candidate fields (not yet selected)');
            sections.push('```json');
            sections.push(stringifyJson(unusedCandidates));
            sections.push('```');
          }
          return wrapForAgent({
            description:
              'a List-Pattern extraction config from the matrx-extend Chrome extension, along with the sample HTML, the rows we extracted, and any candidate fields the inspector found that the user has not yet selected',
            source: { url: tab.url, title: tab.title },
            meta: {
              row_count: rows?.length ?? 0,
              field_count: config.field_paths.length,
              candidate_count: candidates?.length ?? 0,
            },
            format: 'markdown',
            content: sections.join('\n'),
            followUp:
              'Help me improve this pattern: (1) suggest better/more-stable selectors for any fragile fields, (2) recommend additional fields worth extracting based on the sample HTML, (3) call out any fields whose extracted value looks wrong vs what the HTML actually contains.',
          });
        },
      },
    ];
  }, [
    config,
    sampleHtml,
    rows,
    candidates,
    unusedCandidates,
    tab.url,
    tab.title,
    captureSampleHtml,
  ]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 px-3 pb-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            List Pattern
          </div>
          <div className="text-xs text-muted-foreground">
            Click one example item — we find every similar sibling. Then pick fields inside, OR use
            the suggested-fields panel below for one-click adds.
          </div>
        </div>

        {!config ? (
          picking ? (
            <div className="flex gap-2">
              <Button disabled className="flex-1 rounded-full">
                <Loader2 className="animate-spin" />
                Picking on page…
              </Button>
              <Button
                variant="secondary"
                onClick={() => void cancelPicker()}
                className="rounded-full"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => void enterPicker()}
              disabled={!tab.id}
              className="w-full rounded-full"
            >
              <Crosshair />
              Pick an example item
            </Button>
          )
        ) : (
          <div className="space-y-3">
            {/* Pattern header with copy menu */}
            <div className="space-y-1.5 rounded-xl bg-secondary/40 p-3 font-mono text-[11px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-muted-foreground opacity-70">root:</span>
                    <span className="break-all">{config.list_root}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-muted-foreground opacity-70">item:</span>
                    <span className="break-all">{config.item_selector}</span>
                  </div>
                </div>
                <CopyMenu options={patternCopyOptions} title="Copy pattern" size="sm" />
              </div>
            </div>

            {/* Selected fields — full editable + copyable */}
            {fields.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {fields.length} selected field{fields.length === 1 ? '' : 's'}
                </div>
                {fields.map((f, i) => {
                  const expanded = expandedFieldIdx === i;
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows reorder by user.
                    <div key={i} className="space-y-1 rounded-lg bg-secondary/40 px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setExpandedFieldIdx(expanded ? null : i)}
                          className="text-muted-foreground hover:text-foreground"
                          title={expanded ? 'Collapse' : 'Expand to view/edit selector'}
                        >
                          {expanded ? (
                            <ChevronDown className="size-3" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
                        </button>
                        <Input
                          value={f.name}
                          onChange={(e) => updateField(i, { name: e.target.value })}
                          placeholder="field_name"
                          className="h-6 flex-1 rounded-full bg-background/60 px-2 text-[11px]"
                        />
                        {f.attr && (
                          <span className="rounded-full bg-violet-500/15 px-1.5 py-px text-[9px] font-medium text-violet-700 dark:text-violet-400">
                            attr={f.attr}
                          </span>
                        )}
                        <CopyButton
                          text={() =>
                            stringifyJson({
                              name: f.name,
                              rel_selector: f.rel_selector,
                              attr: f.attr,
                            })
                          }
                          size="xs"
                          title="Copy this field as JSON"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeField(i)}
                          className="size-5 shrink-0"
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                      {expanded && (
                        <div className="space-y-1 pl-5">
                          <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            Selector (relative to item)
                          </label>
                          <textarea
                            value={f.rel_selector}
                            onChange={(e) => updateField(i, { rel_selector: e.target.value })}
                            className="block w-full resize-none rounded-md bg-background/60 p-2 font-mono text-[10px] outline-none focus-visible:ring-1"
                            rows={Math.max(2, Math.ceil(f.rel_selector.length / 60))}
                          />
                          <div className="flex items-center gap-1.5">
                            <label className="text-[10px] text-muted-foreground">Attribute:</label>
                            <Input
                              value={f.attr ?? ''}
                              onChange={(e) =>
                                updateField(i, { attr: e.target.value || undefined })
                              }
                              placeholder="(text)"
                              className="h-6 w-24 rounded-full bg-background/60 px-2 text-[11px]"
                            />
                            <span className="text-[10px] text-muted-foreground">
                              empty = innerText
                            </span>
                          </div>
                        </div>
                      )}
                      {!expanded && (
                        <code className="block truncate pl-5 text-[10px] text-muted-foreground">
                          {f.rel_selector}
                        </code>
                      )}
                      <div className="pl-5 text-[10px]">
                        <span className="text-muted-foreground/60">→ </span>
                        <span
                          className={cn(
                            'truncate font-mono',
                            sampleValues[f.name] == null
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400',
                          )}
                          title={sampleValues[f.name] ?? '(no match)'}
                        >
                          {sampleValues[f.name] == null
                            ? '(no match in first item)'
                            : (sampleValues[f.name] ?? '').slice(0, 100)}
                          {(sampleValues[f.name] ?? '').length > 100 && '…'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Candidate-fields panel (auto-discovered from sample card) */}
            {(inspecting || (candidates !== null && unusedCandidates.length > 0)) && (
              <CandidatesPanel
                inspecting={inspecting}
                candidates={unusedCandidates}
                onAdd={addCandidate}
              />
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setConfig(null);
                  setRows(null);
                  setSampleHtml([]);
                  setCandidates(null);
                }}
                className="rounded-full"
              >
                Restart
              </Button>
              <Button
                onClick={() => void enterPicker()}
                disabled={picking}
                variant="secondary"
                className="rounded-full"
              >
                <Crosshair />
                Pick more fields
              </Button>
              <Button
                onClick={() => void handleRun()}
                disabled={running || fields.length === 0}
                className="flex-1 rounded-full"
              >
                {running ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                {running ? 'Extracting…' : 'Extract'}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {rows && (
          <ResultPreview
            rows={rows}
            source={{ url: tab.url, title: tab.title }}
            description="extracted rows from a List-Pattern config in matrx-extend"
          />
        )}

        {rows && rows.length > 0 && config && (
          <div className="flex justify-end">
            <SaveAsPattern
              kind="list_pattern"
              config={config}
              rows={rows}
              source={source}
              defaultName={`List on ${(() => {
                try {
                  return tab.url ? new URL(tab.url).host : 'page';
                } catch {
                  return 'page';
                }
              })()}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function CandidatesPanel({
  inspecting,
  candidates,
  onAdd,
}: {
  inspecting: boolean;
  candidates: CandidateField[];
  onAdd: (c: CandidateField) => void;
}) {
  const [open, setOpen] = useState(true);

  const grouped = useMemo(() => {
    const out = new Map<CandidateField['kind'], CandidateField[]>();
    for (const c of candidates) {
      const arr = out.get(c.kind) ?? [];
      arr.push(c);
      out.set(c.kind, arr);
    }
    return out;
  }, [candidates]);

  return (
    <div className="space-y-1.5 rounded-xl bg-violet-500/5 ring-1 ring-violet-500/30 p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="text-[11px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-400">
          Suggested fields
        </span>
        {inspecting ? (
          <Loader2 className="size-3 animate-spin text-violet-500" />
        ) : (
          <span className="ml-auto rounded-full bg-violet-500/15 px-1.5 py-px text-[10px] font-medium text-violet-700 dark:text-violet-400">
            {candidates.length}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-2">
          {!inspecting && candidates.length === 0 && (
            <div className="text-[11px] text-muted-foreground">
              All available fields are already selected.
            </div>
          )}
          {Array.from(grouped.entries()).map(([kind, items]) => (
            <div key={kind} className="space-y-0.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {KIND_LABELS[kind]}
              </div>
              {items.map((c, i) => (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: candidates render-only.
                  key={i}
                  type="button"
                  onClick={() => onAdd(c)}
                  className={cn(
                    'group flex w-full items-center gap-1.5 rounded-md bg-background/40 px-2 py-1 text-left text-[11px] hover:bg-background/80',
                  )}
                >
                  <Plus className="size-3 shrink-0 text-violet-500" />
                  <span className="w-24 shrink-0 truncate font-mono">{c.name}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.label}</span>
                  <span className="shrink-0 truncate font-mono text-[10px] opacity-60">
                    {c.sample_value}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Chrome's injection errors are raw and unhelpful ("Cannot access a
 * chrome:// URL"). Translate the common ones into guidance.
 */
function friendlyPickError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /cannot access|cannot be scripted|chrome:\/\/|extensions gallery|chrome web store/i.test(msg)
  ) {
    return "This page type doesn't allow picking (browser-internal pages, the Web Store, and PDFs are off-limits). Open a regular website and try again.";
  }
  return msg;
}
