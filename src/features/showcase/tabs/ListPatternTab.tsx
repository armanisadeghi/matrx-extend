import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { isCurrentPageIdentity, useActiveTab } from '@/hooks/use-active-tab';
import { useExtraction } from '@/hooks/use-extraction';
import { stringifyJson, wrapForAgent } from '@/lib/clipboard/copy';
import {
  type CandidateField,
  type CardInspection,
  inspectCardInPage,
} from '@/lib/data-pattern/card-inspector';
import {
  type ListPickerIdentity,
  cancelListPickerSession,
  startListPickerSession,
} from '@/lib/data-pattern/list-picker-session';
import { probeFirstRowInPage } from '@/lib/data-pattern/modes/list-pattern';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { cn } from '@/lib/utils';
import { useShowcaseTabStore } from '@/state/showcase-tab';
import { Button, BasicInput as Input } from '@ai-matrx/design-system';
import { ChevronDown, ChevronRight, Crosshair, Loader2, PlayCircle, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResultPreview } from '../components/ResultPreview';
import { SaveAsPattern } from '../components/SaveAsPattern';

interface FieldPath {
  name: string;
  rel_selector: string;
  // Explicit `undefined` is a valid write here (not merely "absent") — the
  // Attribute input clears back to innerText via `updateField(i, { attr:
  // undefined })`, and that must overwrite a previously-set attr through the
  // `{ ...f, ...patch }` merge in `updateField`.
  attr?: string | undefined;
  transform?: { kind: 'regex'; expr: string } | undefined;
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
  const pageKey = tab.pageKey ?? '';
  const latestPageKeyRef = useRef(pageKey);
  latestPageKeyRef.current = pageKey;
  const lastPageKeyRef = useRef(pageKey);
  const pickPageKeyRef = useRef<string | null>(null);
  const pickerSessionSeqRef = useRef(0);
  const pickerSessionIdRef = useRef<string | null>(null);
  const inspectorSeqRef = useRef(0);
  const runSeqRef = useRef(0);
  const sampleSeqRef = useRef(0);
  const listRecommendation = useShowcaseTabStore((s) => s.listRecommendation);
  const clearListRecommendation = useShowcaseTabStore((s) => s.clearListRecommendation);
  const [picking, setPicking] = useState(false);
  /** Tab the current pick session targets — events from other tabs are ignored. */
  const pickTabRef = useRef<number | null>(null);
  const [rawConfig, setConfig] = useState<ListPickerResult | null>(null);
  const [configPageKey, setConfigPageKey] = useState<string | null>(null);
  const committedConfig = configPageKey === pageKey ? rawConfig : null;
  // The picker can announce a scope before Done so suggested fields are live.
  // Keep that entire editing session provisional until Done; Cancel discards it.
  const [stagedConfig, setStagedConfig] = useState<ListPickerResult | null>(null);
  const stagedConfigRef = useRef<ListPickerResult | null>(null);
  const config =
    picking && pickPageKeyRef.current === pageKey && stagedConfig ? stagedConfig : committedConfig;
  const {
    rows,
    running,
    error: extractionError,
    source,
    previewConfig,
    run,
    reset: resetExtraction,
  } = useExtraction('list_pattern', { autoDetect: false });
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateField[] | null>(null);
  const [inspectionStatus, setInspectionStatus] = useState<
    'idle' | CardInspection['status'] | 'failed'
  >('idle');
  const [inspecting, setInspecting] = useState(false);
  const [sampleHtml, setSampleHtml] = useState<string[]>([]);
  const [expandedFieldIdx, setExpandedFieldIdx] = useState<number | null>(null);
  /** Live per-field sample values, probed using the SAME logic as the runner. */
  const [sampleValues, setSampleValues] = useState<Record<string, string | null>>({});

  const stageConfig = useCallback((next: ListPickerResult | null) => {
    stagedConfigRef.current = next;
    setStagedConfig(next);
  }, []);

  const closePickerSession = useCallback(() => {
    const tabId = pickTabRef.current;
    const sessionId = pickerSessionIdRef.current;
    pickerSessionSeqRef.current += 1;
    pickerSessionIdRef.current = null;
    pickTabRef.current = null;
    pickPageKeyRef.current = null;
    stageConfig(null);
    inspectorSeqRef.current += 1;
    sampleSeqRef.current += 1;
    setCandidates(null);
    setInspectionStatus('idle');
    setSampleValues({});
    setPicking(false);
    if (tabId !== null && sessionId !== null) {
      // Navigated/closed pages may no longer accept an injection. The local
      // session is already invalidated; cancellation can affect only its ID.
      void cancelListPickerSession(tabId, sessionId).catch(() => {});
    }
  }, [stageConfig]);

  useEffect(() => () => closePickerSession(), [closePickerSession]);

  const invalidateBuilderWork = useCallback(() => {
    inspectorSeqRef.current += 1;
    runSeqRef.current += 1;
    sampleSeqRef.current += 1;
    resetExtraction();
    setInspecting(false);
    setCandidates(null);
    setInspectionStatus('idle');
    setSampleValues({});
    setSampleHtml([]);
  }, [resetExtraction]);

  useEffect(() => {
    if (lastPageKeyRef.current === pageKey) return;
    lastPageKeyRef.current = pageKey;
    closePickerSession();
    invalidateBuilderWork();
    setConfig(null);
    setConfigPageKey(null);
    setError(null);
  }, [pageKey, closePickerSession, invalidateBuilderWork]);

  useEffect(() => {
    if (!listRecommendation) return;
    clearListRecommendation(listRecommendation.requestId);
    if (listRecommendation.tabId !== tab.id || listRecommendation.url !== tab.url || listRecommendation.pageKey !== tab.pageKey || !isCurrentPageIdentity(tab.pageKey)) {
      setError(
        'The page changed before List Pattern could use Doctor’s result. Re-probe this page.',
      );
      return;
    }
    closePickerSession();
    invalidateBuilderWork();
    setConfig({
      list_root: listRecommendation.listRoot,
      item_selector: listRecommendation.itemSelector,
      field_paths: [],
    });
    setConfigPageKey(pageKey);
    setError(null);
  }, [
    listRecommendation,
    clearListRecommendation,
    tab.id,
    tab.url,
    pageKey,
    closePickerSession,
    invalidateBuilderWork,
  ]);

  useEffect(() => {
    // STRICT: only the SW's stamped rebroadcast counts. The raw content-
    // script delivery (tab_id absent) reaches every sidepanel directly —
    // accepting it processed each pick TWICE and let window A's pick land
    // in window B's builder.
    const fromOurPick = (payload: Partial<ListPickerIdentity> | null | undefined) =>
      typeof payload?.tab_id === 'number' &&
      payload.tab_id === pickTabRef.current &&
      typeof payload.session_id === 'string' &&
      payload.session_id === pickerSessionIdRef.current &&
      pickPageKeyRef.current === latestPageKeyRef.current && isCurrentPageIdentity(pickPageKeyRef.current);
    const offResult = on<ListPickerResult & ListPickerIdentity, { ack: true }>(
      CHANNELS.LIST_PICKER_RESULT,
      (payload) => {
        if (!fromOurPick(payload)) return { ack: true };
        const sessionPageKey = pickPageKeyRef.current;
        const staged = stagedConfigRef.current;
        closePickerSession();
        if (payload?.list_root && payload.item_selector) {
          invalidateBuilderWork();
          // Merge any newly-picked field_paths into existing config (so "Pick more
          // fields" appends rather than replaces).
          setConfig((prev) => {
            const base = staged ?? prev;
            return base &&
              base.list_root === payload.list_root &&
              base.item_selector === payload.item_selector
              ? {
                  ...base,
                  field_paths: [...base.field_paths, ...payload.field_paths],
                }
              : {
                  list_root: payload.list_root,
                  item_selector: payload.item_selector,
                  field_paths: payload.field_paths,
                };
          });
          setConfigPageKey(sessionPageKey);
          setError(null);
        }
        return { ack: true };
      },
    );
    /**
     * Fires when the picker chooses a scope, before Done. Stage it for live
     * suggestions but do not replace the committed editor/preview on Cancel.
     */
    const offDetected = on<
      { list_root: string; item_selector: string; item_count: number } & ListPickerIdentity,
      { ack: true }
    >(CHANNELS.LIST_PICKER_ITEM_DETECTED, (payload) => {
      if (!payload?.list_root || !payload.item_selector) return { ack: true };
      if (!fromOurPick(payload)) return { ack: true };
      inspectorSeqRef.current += 1;
      sampleSeqRef.current += 1;
      setCandidates(null);
      setInspectionStatus('idle');
      setSampleValues({});
      const prev = stagedConfigRef.current;
      stageConfig(
        prev && prev.list_root === payload.list_root && prev.item_selector === payload.item_selector
          ? prev
          : {
              list_root: payload.list_root,
              item_selector: payload.item_selector,
              field_paths: [],
            },
      );
      setError(null);
      return { ack: true };
    });
    const offExit = on<ListPickerIdentity, { ack: true }>(CHANNELS.LIST_PICKER_EXIT, (payload) => {
      if (!fromOurPick(payload)) return { ack: true };
      closePickerSession();
      return { ack: true };
    });
    return () => {
      offResult();
      offDetected();
      offExit();
    };
  }, [closePickerSession, invalidateBuilderWork, stageConfig]);

  // Auto-run card inspector whenever the item selector changes.
  const runInspector = useCallback(async () => {
    if (!tab.id || !tab.documentId || !tab.pageKey || !config?.list_root || !config.item_selector) return;
    const request = ++inspectorSeqRef.current;
    const pageAtStart = pageKey;
    setInspecting(true);
    setInspectionStatus('idle');
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id, documentIds: [tab.documentId] },
        func: inspectCardInPage,
        args: [{ list_root: config.list_root, item_selector: config.item_selector }],
      });
      if (request !== inspectorSeqRef.current || pageAtStart !== latestPageKeyRef.current || !isCurrentPageIdentity(pageAtStart)) return;
      const inspected = result?.[0]?.result as CardInspection | undefined;
      if (!inspected) throw new Error('Page inspection returned no result.');
      setCandidates(inspected.candidates);
      setInspectionStatus(inspected.status);
    } catch (err) {
      if (request !== inspectorSeqRef.current || pageAtStart !== latestPageKeyRef.current || !isCurrentPageIdentity(pageAtStart)) return;
      console.warn('[matrx-extend] card inspector failed', err);
      setCandidates([]);
      setInspectionStatus('failed');
    } finally {
      if (request === inspectorSeqRef.current && pageAtStart === latestPageKeyRef.current && isCurrentPageIdentity(pageAtStart))
        setInspecting(false);
    }
  }, [tab.id, config?.list_root, config?.item_selector, pageKey]);

  useEffect(() => {
    if (config?.list_root && config.item_selector) {
      void runInspector();
    } else {
      setCandidates(null);
      setInspectionStatus('idle');
    }
  }, [config?.list_root, config?.item_selector, runInspector]);

  /**
   * Probe live sample values for every selected field, using EXACTLY the
   * runner's extraction logic. Re-runs whenever fields change. Debounced so
   * inline edits don't fire a probe per keystroke.
   */
  useEffect(() => {
    if (!tab.id || !tab.documentId || !tab.pageKey || !config || config.field_paths.length === 0) {
      sampleSeqRef.current += 1;
      setSampleValues({});
      return;
    }
    const request = ++sampleSeqRef.current;
    const tid = tab.id;
    const cfgSnapshot = config;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const result = await chrome.scripting.executeScript({
            target: { tabId: tid, documentIds: [tab.documentId!] },
            func: probeFirstRowInPage,
            args: [cfgSnapshot],
          });
          const row = (result?.[0]?.result as Record<string, string | null> | null) ?? {};
          if (request === sampleSeqRef.current && pageKey === latestPageKeyRef.current && isCurrentPageIdentity(pageKey))
            setSampleValues(row ?? {});
        } catch {
          if (request === sampleSeqRef.current && pageKey === latestPageKeyRef.current && isCurrentPageIdentity(pageKey))
            setSampleValues({});
        }
      })();
    }, 300);
    return () => {
      clearTimeout(handle);
      if (request === sampleSeqRef.current) sampleSeqRef.current += 1;
    };
  }, [tab.id, tab.documentId, config, pageKey]);

  // The content-script picker dies silently when the page navigates or the
  // tab closes — without this watcher, picking stays true forever (audit F1).
  useEffect(() => {
    if (!picking) return;
    const pickTab = pickTabRef.current;
    const onUpdated = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId !== pickTab) return;
      if (info.status === 'loading' || info.url) {
        closePickerSession();
        setError('The page navigated while picking — the picker closed. Pick again to continue.');
      }
    };
    const onRemoved = (tabId: number) => {
      if (tabId !== pickTab) return;
      closePickerSession();
      setError('The tab closed while picking.');
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [picking, closePickerSession]);

  const enterPicker = async () => {
    if (!tab.id || !tab.pageKey || picking) return;
    const session = ++pickerSessionSeqRef.current;
    const sessionId = crypto.randomUUID();
    pickerSessionIdRef.current = sessionId;
    stageConfig(config);
    setPicking(true);
    setError(null);
    pickTabRef.current = tab.id;
    pickPageKeyRef.current = pageKey;
    try {
      await startListPickerSession(
        tab.id,
        sessionId,
        config ? { list_root: config.list_root, item_selector: config.item_selector } : null,
      );
    } catch (err) {
      if (session === pickerSessionSeqRef.current) {
        closePickerSession();
        setError(friendlyPickError(err));
      }
    }
  };

  /** Sidepanel-side cancel — recovers a stuck pick without touching the page UI. */
  const cancelPicker = async () => {
    closePickerSession();
  };

  const captureSampleHtml = useCallback(async (): Promise<string[]> => {
    if (!tab.id || !tab.documentId || !tab.pageKey || !config) return [];
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id, documentIds: [tab.documentId] },
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
  }, [tab.id, tab.documentId, pageKey, config]);

  const handleRun = async () => {
    if (!tab.id || !tab.pageKey || !config) return;
    const request = ++runSeqRef.current;
    const pageAtStart = pageKey;
    setError(null);
    const data = await run(config);
    if (request !== runSeqRef.current || pageAtStart !== latestPageKeyRef.current || !isCurrentPageIdentity(pageAtStart)) return;
    if (data.length > 0) {
      // Snapshot 1-2 cards' HTML for later AI-paste.
      const samples = await captureSampleHtml();
      if (request === runSeqRef.current && pageAtStart === latestPageKeyRef.current && isCurrentPageIdentity(pageAtStart))
        setSampleHtml(samples);
    }
  };

  const updateField = (i: number, patch: Partial<FieldPath>) => {
    if (!config) return;
    const next = {
      ...config,
      field_paths: config.field_paths.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    };
    if (pickerSessionIdRef.current) stageConfig(next);
    else setConfig(next);
  };

  const removeField = (i: number) => {
    if (!config) return;
    const next = {
      ...config,
      field_paths: config.field_paths.filter((_, idx) => idx !== i),
    };
    if (pickerSessionIdRef.current) stageConfig(next);
    else setConfig(next);
  };

  const addCandidate = (c: CandidateField) => {
    if (!config) return;
    const next = {
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
    };
    if (pickerSessionIdRef.current) stageConfig(next);
    else setConfig(next);
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
  // A pending scope can differ from the executed preview. Keep the previous
  // preview intact for Cancel, but never present it as output for that draft.
  const displayRows = picking ? null : rows;

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
          let samples = picking ? [] : sampleHtml;
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
          if (displayRows && displayRows.length > 0) {
            sections.push('');
            sections.push(`## Extracted rows (showing first 5 of ${displayRows.length})`);
            sections.push('```json');
            sections.push(stringifyJson(displayRows.slice(0, 5)));
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
              row_count: displayRows?.length ?? 0,
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
    displayRows,
    picking,
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
              disabled={!tab.pageKey}
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
            {(inspecting || inspectionStatus !== 'idle') && (
              <CandidatesPanel
                inspecting={inspecting}
                status={inspectionStatus}
                candidates={unusedCandidates}
                selectedCount={fields.length}
                onAdd={addCandidate}
              />
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setConfig(null);
                  setConfigPageKey(null);
                  closePickerSession();
                  invalidateBuilderWork();
                }}
                className="rounded-full"
              >
                Restart
              </Button>
              <Button
                onClick={() => void enterPicker()}
                disabled={picking || !tab.pageKey}
                variant="secondary"
                className="rounded-full"
              >
                <Crosshair />
                Pick more fields
              </Button>
              <Button
                onClick={() => void handleRun()}
                disabled={running || fields.length === 0 || !tab.pageKey}
                className="flex-1 rounded-full"
              >
                {running ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                {running ? 'Extracting…' : 'Extract'}
              </Button>
            </div>
          </div>
        )}

        {(error || extractionError) && (
          <div className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error || extractionError}
          </div>
        )}

        {displayRows && (
          <ResultPreview
            rows={displayRows}
            source={source}
            description="extracted rows from a List-Pattern config in matrx-extend"
          />
        )}

        {displayRows && displayRows.length > 0 && previewConfig != null && (
          <div className="flex justify-end">
            <SaveAsPattern
              kind="list_pattern"
              config={previewConfig}
              rows={displayRows}
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
  status,
  candidates,
  selectedCount,
  onAdd,
}: {
  inspecting: boolean;
  status: 'idle' | CardInspection['status'] | 'failed';
  candidates: CandidateField[];
  selectedCount: number;
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
          {!inspecting && status === 'root_missing' && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              The detected list is no longer on this page. Re-probe in Doctor or pick an example
              item.
            </div>
          )}
          {!inspecting && status === 'items_missing' && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              The detected list has no matching items now. Re-probe in Doctor or pick an example
              item.
            </div>
          )}
          {!inspecting && status === 'failed' && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400">
              Suggested fields could not be inspected. Try picking fields on the page, or re-probe
              in Doctor.
            </div>
          )}
          {!inspecting && status === 'ready' && candidates.length === 0 && (
            <div className="text-[11px] text-muted-foreground">
              {selectedCount > 0
                ? 'All suggested fields are already selected.'
                : 'No suggested fields found. Pick fields on the page or edit the selectors.'}
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
