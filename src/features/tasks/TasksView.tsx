import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { stringifyJson, wrapForAgent } from '@/lib/clipboard/copy';
import {
  type ExtensionScrapeItem,
  type ExtensionScrapeQueue,
  type SubmittableLevel,
  type UserVerdict,
  applyVerdict,
  getExtensionScrapeQueue,
  submitExtensionContent,
  submitPasteContent,
} from '@/lib/api/routes/research';
import { getOuterHtml } from '@/lib/scrape/capture-html';
import { scrollToLoadLazy, settlePage } from '@/lib/scrape/page-ready';
import { removeCaptureOverlay, showCaptureOverlay } from '@/lib/scrape/user-gate-overlay';
import { CHANNELS } from '@/lib/messaging/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  CheckCircle,
  ChevronDown,
  ExternalLink,
  Loader2,
  Lock,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Skull,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type TaskStatus =
  | 'idle'
  | 'navigating'
  | 'preparing'
  | 'awaiting_user'
  | 'scraping'
  | 'submitting'
  | 'success'
  | 'thin'
  | 'error'
  | 'completed';

interface ItemState {
  status: TaskStatus;
  tabId?: number;
  charCount?: number;
  error?: string;
  nextLevel?: 1 | 2 | 3 | 4;
  /** First ~300 chars of the last capture, shown in the verdict card. */
  preview?: string;
  /** Set after a user-driven thin L3 capture so the verdict card stays visible. */
  showVerdictCard?: boolean;
  /** Verdict request in flight — disables buttons. */
  verdictPending?: UserVerdict;
}

const RUNNING_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'navigating',
  'preparing',
  'awaiting_user',
  'scraping',
  'submitting',
]);

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'success',
  'thin',
  'completed',
]);

function itemKey(it: ExtensionScrapeItem): string {
  return `${it.topic_id}:${it.source_id}`;
}

export function TasksView() {
  const queryClient = useQueryClient();
  const [statusByItem, setStatusByItem] = useState<Record<string, ItemState>>({});
  const [pasteByItem, setPasteByItem] = useState<Record<string, string>>({});
  /**
   * Sources whose verdict card is open, pinned to the L3 view regardless of
   * what the server's queue currently says. The backend may have already
   * advanced these to L4, but we hold them in L3 until the user resolves
   * the verdict — otherwise the row owning the card vanishes mid-decision.
   */
  const [pinnedL3, setPinnedL3] = useState<Record<string, ExtensionScrapeItem>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    level_1_quick: true,
    level_2_scroll: true,
    level_3_user_gated: true,
    level_4_paste: true,
  });
  const [batchProgress, setBatchProgress] = useState<
    | { current: number; total: number; succeeded: number; failed: number }
    | null
  >(null);
  const batchRunning = batchProgress !== null;

  const {
    data: queue,
    error: queryError,
    isPending,
    isFetching,
    refetch,
  } = useQuery<ExtensionScrapeQueue, Error>({
    queryKey: ['scrape-queue'],
    queryFn: async () => {
      const r = await getExtensionScrapeQueue();
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    staleTime: 60_000,
  });
  const error = queryError?.message ?? null;

  // Latest values available to chrome.runtime.onMessage listeners that can't
  // close over reactive state directly.
  const queueRef = useRef<ExtensionScrapeQueue | undefined>(undefined);
  queueRef.current = queue;
  const statusRef = useRef(statusByItem);
  statusRef.current = statusByItem;

  // Listen for in-page overlay button clicks (Level 3 capture / cancel /
  // pre-decided verdicts: dead link, expect thin).
  useEffect(() => {
    const onMessage = (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      const m = msg as { __matrx?: boolean; kind?: string; payload?: unknown };
      if (m.__matrx !== true) return;
      const overlayKinds = new Set<string>([
        CHANNELS.TASKS_USER_GO,
        CHANNELS.TASKS_USER_CANCEL,
        CHANNELS.TASKS_USER_DEAD,
        CHANNELS.TASKS_USER_GATED,
        CHANNELS.TASKS_USER_EXPECT_THIN,
      ]);
      if (!m.kind || !overlayKinds.has(m.kind)) return;
      const payload = m.payload as { topicId?: string; sourceId?: string } | undefined;
      if (!payload?.topicId || !payload.sourceId) return;
      const q = queueRef.current;
      if (!q) return;
      const item = q.level_3_user_gated.find(
        (it) => it.topic_id === payload.topicId && it.source_id === payload.sourceId,
      );
      if (!item) return;
      if (m.kind === CHANNELS.TASKS_USER_GO) void runUserGo(item);
      else if (m.kind === CHANNELS.TASKS_USER_DEAD) void runUserDead(item);
      else if (m.kind === CHANNELS.TASKS_USER_GATED) void runUserGated(item);
      else if (m.kind === CHANNELS.TASKS_USER_EXPECT_THIN) void runUserExpectThin(item);
      else runUserCancel(item);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After every queue refresh, drop "thin" / "error" badges for items still in
  // the queue — the source has moved up the ladder, so it's effectively a fresh
  // attempt now and the Run button should reappear. Preserve `awaiting_user`
  // (mid-flow, has live tabId), `success` / `completed` (terminal acks), and
  // any item with an open verdict card (the user is mid-decision).
  // Also drop pinned-to-L3 items if the source is no longer anywhere in the
  // queue — that means a verdict landed and the source went terminal.
  useEffect(() => {
    if (!queue) return;
    const liveIds = new Set<string>([
      ...queue.level_1_quick.map(itemKey),
      ...queue.level_2_scroll.map(itemKey),
      ...queue.level_3_user_gated.map(itemKey),
      ...queue.level_4_paste.map(itemKey),
    ]);
    setStatusByItem((prev) => {
      let changed = false;
      const next: Record<string, ItemState> = {};
      for (const [id, state] of Object.entries(prev)) {
        const isStaleBadge = state.status === 'thin' || state.status === 'error';
        if (liveIds.has(id) && isStaleBadge && !state.showVerdictCard) {
          changed = true;
          continue;
        }
        next[id] = state;
      }
      return changed ? next : prev;
    });
    setPinnedL3((prev) => {
      let changed = false;
      const next: Record<string, ExtensionScrapeItem> = {};
      for (const [id, item] of Object.entries(prev)) {
        if (!liveIds.has(id)) {
          changed = true;
          continue;
        }
        next[id] = item;
      }
      return changed ? next : prev;
    });
  }, [queue]);

  const setItemState = (id: string, patch: ItemState) =>
    setStatusByItem((s) => ({ ...s, [id]: patch }));

  const invalidateQueue = () =>
    queryClient.invalidateQueries({ queryKey: ['scrape-queue'] });

  /** Capture flow for Level 1 / 2 / 3. Level 4 (paste) goes through `runPaste`. */
  const runAutomated = async (
    item: ExtensionScrapeItem,
    level: SubmittableLevel,
  ): Promise<{ ok: boolean; isGood: boolean }> => {
    const id = itemKey(item);
    const wantsActiveTab = level === 3;

    setItemState(id, { status: 'navigating' });
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.create({ url: item.url, active: wantsActiveTab });
    } catch (err) {
      setItemState(id, { status: 'error', error: (err as Error).message });
      return { ok: false, isGood: false };
    }
    if (!tab.id) {
      setItemState(id, { status: 'error', error: 'Tab has no id' });
      return { ok: false, isGood: false };
    }
    const tabId = tab.id;
    await waitForTab(tabId);

    if (level >= 2) {
      setItemState(id, { status: 'preparing', tabId });
      await settlePage(tabId);
      await scrollToLoadLazy(tabId);
    }

    if (level === 3) {
      // Stop and surface the tab to the user. They click past obstacles, then
      // click "Capture page" in the in-page overlay (or "Go" in the side panel).
      try {
        await chrome.tabs.update(tabId, { active: true });
      } catch {
        /* tab may have been closed */
      }
      void showCaptureOverlay(tabId, item.topic_id, item.source_id, item.topic_name);
      setItemState(id, { status: 'awaiting_user', tabId });
      return { ok: true, isGood: false };
    }

    return captureAndSubmit(item, level, tabId, /* keepTabOpen */ false);
  };

  const runUserGo = async (item: ExtensionScrapeItem) => {
    const id = itemKey(item);
    const tabId = statusRef.current[id]?.tabId;
    if (tabId == null) {
      setItemState(id, { status: 'error', error: 'Tab is no longer open' });
      return;
    }
    void removeCaptureOverlay(tabId);
    await captureAndSubmit(item, 3, tabId, /* keepTabOpen */ true);
  };

  /**
   * "Expect thin content" overlay button — capture as normal, but if the
   * backend says thin, apply accept_as_is automatically. The user has
   * already seen the page and pre-decided.
   */
  const runUserExpectThin = async (item: ExtensionScrapeItem) => {
    const id = itemKey(item);
    const tabId = statusRef.current[id]?.tabId;
    if (tabId == null) {
      setItemState(id, { status: 'error', error: 'Tab is no longer open' });
      return;
    }
    void removeCaptureOverlay(tabId);
    await captureAndSubmit(item, 3, tabId, /* keepTabOpen */ true, { acceptThin: true });
    // Close the tab once we're done — user already gave the verdict implicitly.
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      /* ignore */
    }
  };

  /**
   * Pre-decided terminal verdict from the in-page overlay. The user looked
   * at the page and knows it's dead (404) or gated (login/paywall) — no
   * scrape needed, just record their answer and clean up.
   */
  const runUserPreDecided = async (
    item: ExtensionScrapeItem,
    verdict: 'dead_link' | 'gated',
  ) => {
    const id = itemKey(item);
    const tabId = statusRef.current[id]?.tabId;
    if (tabId != null) void removeCaptureOverlay(tabId);
    setItemState(id, { status: 'submitting', tabId });
    const r = await applyVerdict(item.topic_id, item.source_id, verdict);
    if (!r.ok) {
      setItemState(id, { status: 'error', error: r.error });
      return;
    }
    setItemState(id, { status: 'completed' });
    if (tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* ignore */
      }
    }
    void invalidateQueue();
  };

  const runUserDead = (item: ExtensionScrapeItem) => runUserPreDecided(item, 'dead_link');
  const runUserGated = (item: ExtensionScrapeItem) => runUserPreDecided(item, 'gated');

  const runUserCancel = (item: ExtensionScrapeItem) => {
    const id = itemKey(item);
    const tabId = statusRef.current[id]?.tabId;
    if (tabId != null) void removeCaptureOverlay(tabId);
    setStatusByItem((s) => {
      const { [id]: _drop, ...rest } = s;
      return rest;
    });
  };

  /** Returns whether the submit landed AND whether the parse was good. */
  const captureAndSubmit = async (
    item: ExtensionScrapeItem,
    level: SubmittableLevel,
    tabId: number,
    keepTabOpen: boolean,
    options: { acceptThin?: boolean } = {},
  ): Promise<{ ok: boolean; isGood: boolean }> => {
    const id = itemKey(item);
    setItemState(id, { status: 'scraping', tabId });
    let html: string;
    try {
      html = await getOuterHtml(tabId);
    } catch (err) {
      setItemState(id, { status: 'error', error: (err as Error).message });
      return { ok: false, isGood: false };
    }

    setItemState(id, { status: 'submitting', tabId });
    const result = await submitExtensionContent(item.topic_id, item.source_id, html, level);
    if (!result.ok) {
      setItemState(id, { status: 'error', error: result.error });
      return { ok: false, isGood: false };
    }

    if (!keepTabOpen) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* ignore */
      }
    }

    const { is_good_scrape, char_count, next_level } = result.data;

    // User pre-declared "expect thin" before clicking — auto-apply
    // accept_as_is on a thin result and skip the verdict card entirely.
    if (!is_good_scrape && options.acceptThin) {
      const v = await applyVerdict(item.topic_id, item.source_id, 'accept_as_is');
      setItemState(id, {
        status: v.ok ? 'completed' : 'error',
        charCount: char_count,
        error: v.ok ? undefined : v.error,
      });
      void invalidateQueue();
      return { ok: v.ok, isGood: false };
    }

    // After a user-driven L3 capture, surface the verdict card if the parse
    // was thin — they're staring at the page and can give a final answer.
    const showVerdictCard = !is_good_scrape && level === 3;
    setItemState(id, {
      status: is_good_scrape ? 'success' : 'thin',
      charCount: char_count,
      nextLevel: next_level ?? undefined,
      preview: showVerdictCard ? extractTextPreview(html) : undefined,
      showVerdictCard,
    });
    if (showVerdictCard) {
      // Pin this source to the L3 view so the row hosting the card can't
      // disappear when the server's queue refreshes (the backend has already
      // moved the source to L4). Unpinned by `runVerdict` or by the cleanup
      // useEffect when the source leaves the queue entirely.
      setPinnedL3((p) => ({ ...p, [id]: item }));
    } else {
      // Successful or non-L3 — let the normal queue refresh flow run.
      void invalidateQueue();
    }
    return { ok: true, isGood: is_good_scrape };
  };

  const runPaste = async (item: ExtensionScrapeItem) => {
    const id = itemKey(item);
    const content = (pasteByItem[id] ?? '').trim();
    if (!content) {
      setItemState(id, { status: 'error', error: 'Paste some content first' });
      return;
    }
    setItemState(id, { status: 'submitting' });
    const r = await submitPasteContent(item.topic_id, item.source_id, content);
    if (!r.ok) {
      setItemState(id, { status: 'error', error: r.error });
      return;
    }
    setItemState(id, { status: 'success', charCount: content.length });
    setPasteByItem((p) => {
      const { [id]: _drop, ...rest } = p;
      return rest;
    });
    void invalidateQueue();
  };

  const runVerdict = async (item: ExtensionScrapeItem, verdict: UserVerdict) => {
    const id = itemKey(item);
    const prev = statusRef.current[id];
    setStatusByItem((s) => ({ ...s, [id]: { ...prev, status: prev?.status ?? 'idle', verdictPending: verdict } }));
    const r = await applyVerdict(item.topic_id, item.source_id, verdict);
    if (!r.ok) {
      setItemState(id, { status: 'error', error: r.error });
      return;
    }
    // 'retry' requeues the source — the next queue refresh will re-show it.
    // The other two are terminal and the row will disappear from the queue.
    setItemState(id, {
      status: verdict === 'retry' ? 'idle' : 'completed',
    });
    setPinnedL3((p) => {
      if (!(id in p)) return p;
      const { [id]: _drop, ...rest } = p;
      return rest;
    });
    void invalidateQueue();
  };

  /**
   * Run automated batch — Level 1 + Level 2 sequentially.
   * Skips items already in a running or terminal state from this session.
   */
  const runBatch = async () => {
    if (!queue) return;
    const targets = [
      ...queue.level_1_quick.map((it) => ({ item: it, level: 1 as const })),
      ...queue.level_2_scroll.map((it) => ({ item: it, level: 2 as const })),
    ].filter(({ item }) => {
      const cur = statusByItem[itemKey(item)]?.status;
      return !cur || (!RUNNING_STATUSES.has(cur) && !TERMINAL_STATUSES.has(cur));
    });
    if (targets.length === 0) return;
    setBatchProgress({ current: 0, total: targets.length, succeeded: 0, failed: 0 });
    try {
      let succeeded = 0;
      let failed = 0;
      let current = 0;
      for (const { item, level } of targets) {
        current++;
        setBatchProgress({ current, total: targets.length, succeeded, failed });
        // eslint-disable-next-line no-await-in-loop
        const r = await runAutomated(item, level);
        if (r.ok && r.isGood) succeeded++;
        else failed++; // !ok or ok-but-thin both count as needs-more-work
        setBatchProgress({ current, total: targets.length, succeeded, failed });
      }
    } finally {
      setBatchProgress(null);
    }
  };

  // Pinned-to-L3 sources (those with an open verdict card) override whatever
  // bucket the server now reports, so the row hosting the card never vanishes
  // mid-decision. These are filtered out of the other buckets to avoid double
  // rendering.
  const pinnedIds = new Set(Object.keys(pinnedL3));
  const filterPinned = (items: ExtensionScrapeItem[]) =>
    pinnedIds.size === 0 ? items : items.filter((it) => !pinnedIds.has(itemKey(it)));
  const displayL1 = queue ? filterPinned(queue.level_1_quick) : [];
  const displayL2 = queue ? filterPinned(queue.level_2_scroll) : [];
  const pinnedFromServer = queue ? new Set(queue.level_3_user_gated.map(itemKey)) : new Set<string>();
  const displayL3 = queue
    ? [
        ...Object.values(pinnedL3).filter((it) => !pinnedFromServer.has(itemKey(it))),
        ...queue.level_3_user_gated,
      ]
    : [];
  const displayL4 = queue ? filterPinned(queue.level_4_paste) : [];

  const totalAutomated = displayL1.length + displayL2.length;
  const totalAll = queue?.totals?.all ?? 0;

  const toggleSection = (k: string) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Scrape queue</span>
        {queue && (
          <span className="ml-1.5 text-xs text-muted-foreground">{totalAll}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {queue && totalAll > 0 && (
            <CopyMenu
              title="Copy queue"
              options={[
                {
                  label: 'URLs (one per line)',
                  getContent: () =>
                    [
                      ...queue.level_1_quick,
                      ...queue.level_2_scroll,
                      ...queue.level_3_user_gated,
                      ...queue.level_4_paste,
                    ]
                      .map((it) => it.url)
                      .join('\n'),
                },
                {
                  label: 'For AI agent',
                  ai: true,
                  getContent: () => {
                    const all = [
                      ...queue.level_1_quick,
                      ...queue.level_2_scroll,
                      ...queue.level_3_user_gated,
                      ...queue.level_4_paste,
                    ];
                    return wrapForAgent({
                      description: 'a queue of pending scrape tasks from Matrx',
                      meta: { count: all.length },
                      format: 'text',
                      content: all
                        .map((it) =>
                          `- ${it.topic_name ?? it.topic_id}\n  ${it.url}`,
                        )
                        .join('\n'),
                    });
                  },
                },
                {
                  label: 'Queue (JSON)',
                  adminOnly: true,
                  getContent: () => stringifyJson(queue),
                },
              ]}
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => void refetch()}
            title="Refresh"
            disabled={isFetching}
          >
            <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3 px-3 pb-3">
          {isPending && !error && (
            <>
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> {error}
            </div>
          )}
          {queue && totalAll === 0 && !error && (
            <div className="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground">
              Nothing in the queue. Add tasks from the Matrx app.
            </div>
          )}

          {queue && (displayL1.length > 0 || displayL2.length > 0) && (
            <Section
              title="Automated"
              subtitle="No interaction needed — extension scrapes for you."
              count={totalAutomated}
              open={!!(openSections.level_1_quick || openSections.level_2_scroll)}
              onToggle={() => {
                const both = openSections.level_1_quick && openSections.level_2_scroll;
                setOpenSections((s) => ({
                  ...s,
                  level_1_quick: !both,
                  level_2_scroll: !both,
                }));
              }}
            >
              {displayL1.map((it) => (
                <Row
                  key={itemKey(it)}
                  item={it}
                  level={1}
                  state={statusByItem[itemKey(it)]}
                  onRun={() => void runAutomated(it, 1)}
                  onVerdict={(v) => void runVerdict(it, v)}
                />
              ))}
              {displayL2.map((it) => (
                <Row
                  key={itemKey(it)}
                  item={it}
                  level={2}
                  state={statusByItem[itemKey(it)]}
                  onRun={() => void runAutomated(it, 2)}
                  onVerdict={(v) => void runVerdict(it, v)}
                />
              ))}
            </Section>
          )}

          {queue && displayL3.length > 0 && (
            <Section
              title="Needs your help"
              subtitle="The auto-scraper kept getting thin pages here. Trigger one, get the page fully loaded, then press Go — or resolve it directly."
              count={displayL3.length}
              open={!!openSections.level_3_user_gated}
              onToggle={() => toggleSection('level_3_user_gated')}
              tone="amber"
            >
              {displayL3.map((it) => (
                <Row
                  key={itemKey(it)}
                  item={it}
                  level={3}
                  state={statusByItem[itemKey(it)]}
                  onRun={() => void runAutomated(it, 3)}
                  onUserGo={() => void runUserGo(it)}
                  onVerdict={(v) => void runVerdict(it, v)}
                />
              ))}
            </Section>
          )}

          {queue && displayL4.length > 0 && (
            <Section
              title="Manual paste"
              subtitle="Open the URL in a normal tab, copy the content, paste it here — or resolve directly if the page is gone."
              count={displayL4.length}
              open={!!openSections.level_4_paste}
              onToggle={() => toggleSection('level_4_paste')}
              tone="amber"
            >
              {displayL4.map((it) => {
                const id = itemKey(it);
                return (
                  <PasteRow
                    key={id}
                    item={it}
                    state={statusByItem[id]}
                    value={pasteByItem[id] ?? ''}
                    onChange={(v) => setPasteByItem((p) => ({ ...p, [id]: v }))}
                    onSubmit={() => void runPaste(it)}
                    onVerdict={(v) => void runVerdict(it, v)}
                  />
                );
              })}
            </Section>
          )}
        </div>
      </div>

      {totalAutomated > 0 && (
        <div className="shrink-0 px-3 pb-3 pt-1">
          <Button
            onClick={() => void runBatch()}
            disabled={batchRunning}
            className="w-full rounded-full"
          >
            {batchProgress ? (
              <>
                <Loader2 className="animate-spin" />
                {batchProgress.current} / {batchProgress.total}
                {batchProgress.succeeded > 0 && ` · ${batchProgress.succeeded} captured`}
              </>
            ) : (
              <>
                <PlayCircle /> Run automated batch ({totalAutomated})
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  open,
  onToggle,
  tone,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  tone?: 'amber';
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-secondary/40 ${
          tone === 'amber' ? 'text-amber-700 dark:text-amber-400' : ''
        }`}
      >
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {title}
            <span className="ml-1.5 text-xs text-muted-foreground">{count}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function Row({
  item,
  level,
  state,
  onRun,
  onUserGo,
  onVerdict,
}: {
  item: ExtensionScrapeItem;
  level: 1 | 2 | 3;
  state?: ItemState;
  onRun: () => void;
  onUserGo?: () => void;
  onVerdict: (verdict: UserVerdict) => void;
}) {
  const status = state?.status ?? 'idle';
  const errorMsg = state?.error;
  const charCount = state?.charCount;
  const showVerdictCard = state?.showVerdictCard === true;

  return (
    <div className="group rounded-xl bg-secondary/40 px-3 py-2.5 transition-colors hover:bg-secondary/70">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.topic_name}</div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-xs text-muted-foreground hover:underline"
          >
            {item.url}
          </a>
          <ItemContext item={item} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyButton
            text={item.url}
            title="Copy URL"
            size="xs"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          />
          <Status status={status} charCount={charCount} />
          {status === 'awaiting_user' && (
            <Button
              size="sm"
              className="h-7 rounded-full bg-emerald-600 px-3 text-xs hover:bg-emerald-700"
              onClick={onUserGo}
            >
              Go
            </Button>
          )}
          {(status === 'idle' || status === 'error') && (
            <Button
              size="sm"
              variant={level === 3 ? 'default' : 'ghost'}
              className="h-7 rounded-full px-3 text-xs"
              onClick={onRun}
            >
              {level === 3 ? 'Trigger' : 'Run'}
            </Button>
          )}
          <ResolveMenu
            onVerdict={onVerdict}
            pending={state?.verdictPending}
            includeRetry={item.attempted_levels.length > 0}
          />
        </div>
      </div>
      {errorMsg && <div className="mt-1.5 text-xs text-destructive">{errorMsg}</div>}
      {showVerdictCard && (
        <VerdictCard
          charCount={charCount}
          preview={state?.preview}
          pending={state?.verdictPending}
          onVerdict={onVerdict}
        />
      )}
    </div>
  );
}

function PasteRow({
  item,
  state,
  value,
  onChange,
  onSubmit,
  onVerdict,
}: {
  item: ExtensionScrapeItem;
  state?: ItemState;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onVerdict: (verdict: UserVerdict) => void;
}) {
  const status = state?.status ?? 'idle';
  const errorMsg = state?.error;
  const charCount = state?.charCount;
  const submitting = status === 'submitting';
  const done = status === 'success' || status === 'completed';

  return (
    <div className="space-y-2 rounded-xl bg-secondary/40 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.topic_name}</div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground hover:underline"
          >
            {item.url} <ExternalLink className="size-3" />
          </a>
          <ItemContext item={item} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Status status={status} charCount={charCount} />
          <ResolveMenu
            onVerdict={onVerdict}
            pending={state?.verdictPending}
            includeRetry={item.attempted_levels.length > 0}
          />
        </div>
      </div>
      {!done && (
        <>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paste the article content here…"
            rows={4}
            className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:border-primary focus:outline-none"
            disabled={submitting}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              className="h-7 rounded-full px-3 text-xs"
              onClick={onSubmit}
              disabled={!value.trim() || submitting}
            >
              {submitting ? <Loader2 className="size-3 animate-spin" /> : 'Submit paste'}
            </Button>
          </div>
        </>
      )}
      {errorMsg && <div className="text-xs text-destructive">{errorMsg}</div>}
    </div>
  );
}

function ItemContext({ item }: { item: ExtensionScrapeItem }) {
  const bits: string[] = [];
  if (item.attempted_levels && item.attempted_levels.length > 0) {
    bits.push(`tried L${item.attempted_levels.join(', L')}`);
  }
  if (item.last_char_count != null) bits.push(`last: ${item.last_char_count.toLocaleString()} chars`);
  if (item.last_attempt_at) {
    const ago = relativeTime(item.last_attempt_at);
    if (ago) bits.push(ago);
  }
  if (bits.length === 0 && !item.last_failure_reason) return null;
  return (
    <div className="mt-0.5 space-y-0.5">
      {bits.length > 0 && (
        <div className="truncate text-[11px] text-muted-foreground/70">{bits.join(' · ')}</div>
      )}
      {item.last_failure_reason && (
        <div className="truncate text-[11px] text-muted-foreground/60" title={item.last_failure_reason}>
          {item.last_failure_reason}
        </div>
      )}
    </div>
  );
}

function relativeTime(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function Status({ status, charCount }: { status: TaskStatus; charCount?: number }) {
  if (status === 'idle') return null;
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" />
        {charCount != null ? `${charCount.toLocaleString()} chars` : 'done'}
      </span>
    );
  }
  if (status === 'thin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        <AlertTriangle className="size-3.5" />
        thin{charCount != null ? ` · ${charCount.toLocaleString()}` : ''}
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5" /> marked complete
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <ExternalLink className="size-3.5" /> error
      </span>
    );
  }
  if (status === 'awaiting_user') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
        Click past obstacles →
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> {status}
    </span>
  );
}

/**
 * Resolve dropdown — applies a user verdict directly without opening the page.
 * Verdicts are an OPTIONAL escape hatch; the auto-pipeline handles escalation
 * fine without them. We never force the user to pick one. "Bot was blocked"
 * is intentionally absent — when the user is the actor they're already past
 * any obstacle, so blocked isn't a verdict.
 */
function ResolveMenu({
  onVerdict,
  pending,
  includeRetry,
}: {
  onVerdict: (verdict: UserVerdict) => void;
  pending?: UserVerdict;
  includeRetry: boolean;
}) {
  const [open, setOpen] = useState(false);
  const choose = (v: UserVerdict) => {
    setOpen(false);
    onVerdict(v);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Resolve"
          className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          disabled={pending !== undefined}
        >
          {pending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <>
              Resolve <ChevronDown className="size-3" />
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <VerdictMenuItem
          icon={CheckCircle}
          label="This is the whole page"
          description="Sparse content is correct — accept and move on."
          onClick={() => choose('accept_as_is')}
        />
        <VerdictMenuItem
          icon={Lock}
          label="Page is gated"
          description="Login / paywall / captcha. Stop trying."
          onClick={() => choose('gated')}
        />
        <VerdictMenuItem
          icon={Skull}
          label="Page is dead / 404"
          description="URL is gone. Don't surface this again."
          onClick={() => choose('dead_link')}
        />
        {includeRetry && (
          <VerdictMenuItem
            icon={RotateCcw}
            label="Retry from scratch"
            description="Throw away the last result and requeue."
            onClick={() => choose('retry')}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function VerdictMenuItem({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: typeof CheckCircle;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
    >
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{label}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}

/**
 * Inline card shown after a user-driven L3 capture comes back thin. The user
 * is staring at the page — show what we got and let them give a final answer
 * instead of letting the pipeline silently bump to manual paste.
 */
function VerdictCard({
  charCount,
  preview,
  pending,
  onVerdict,
}: {
  charCount?: number;
  preview?: string;
  pending?: UserVerdict;
  onVerdict: (verdict: UserVerdict) => void;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
      <div className="text-xs font-medium text-amber-700 dark:text-amber-300">
        Only {charCount?.toLocaleString() ?? '0'} chars extracted. What is it actually?
      </div>
      {preview && (
        <div className="max-h-24 overflow-y-auto rounded bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
          {preview}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          className="h-7 rounded-full px-3 text-xs"
          disabled={pending !== undefined}
          onClick={() => onVerdict('accept_as_is')}
        >
          {pending === 'accept_as_is' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <CheckCircle className="size-3.5" />
          )}
          That's the whole page
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 rounded-full px-3 text-xs"
          disabled={pending !== undefined}
          onClick={() => onVerdict('gated')}
        >
          {pending === 'gated' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Lock className="size-3.5" />
          )}
          Gated
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 rounded-full px-3 text-xs"
          disabled={pending !== undefined}
          onClick={() => onVerdict('dead_link')}
        >
          {pending === 'dead_link' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Skull className="size-3.5" />
          )}
          Page is dead
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-full px-3 text-xs"
          disabled={pending !== undefined}
          onClick={() => onVerdict('retry')}
        >
          {pending === 'retry' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          Retry
        </Button>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Or hit refresh to skip — this source will move to manual paste on its own.
      </div>
    </div>
  );
}

/** Strip tags + whitespace, return the first ~300 chars for the verdict card. */
function extractTextPreview(html: string, max = 300): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

function waitForTab(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const check = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && change.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(check);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(check);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(check);
      resolve();
    }, 30_000);
  });
}
