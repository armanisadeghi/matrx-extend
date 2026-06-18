import { AddToProjectButton } from '@/components/AddToProjectButton';
import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { ParallelRunsPanel } from '@/features/tasks/ParallelRunsPanel';
import { type BatchProgress, QueueSelectionBar } from '@/features/tasks/QueueSelectionBar';
import { QueueToolbar } from '@/features/tasks/QueueToolbar';
import {
  BUCKET_LABELS,
  BUCKET_LEVEL,
  type BucketKey,
  type FlatQueueItem,
  buildGroups,
  computeFacets,
  domainOf,
  filterAndSort,
  flattenQueue,
  itemKey,
} from '@/features/tasks/queue-view';
import { VERDICT_OPTIONS, VERDICT_SHORT } from '@/features/tasks/verdicts';
import { useActiveTab } from '@/hooks/use-active-tab';
import {
  type BulkVerdictItem,
  type ExtensionScrapeItem,
  type ExtensionScrapeQueue,
  type PolicyCategory,
  type SubmittableLevel,
  type UserVerdict,
  applyVerdict,
  applyVerdictBulk,
  getExtensionScrapeQueue,
  submitExtensionContent,
  submitPasteContent,
} from '@/lib/api/routes/research';
import { stringifyJson, wrapForAgent } from '@/lib/clipboard/copy';
import { CHANNELS } from '@/lib/messaging/schemas';
import { runEnrich } from '@/lib/research/enrich';
import { ENRICH_GOAL_INFO } from '@/lib/research/enrich-types';
import { getOuterHtml } from '@/lib/scrape/capture-html';
import { getCapturePageData } from '@/lib/scrape/capture-media';
import { scrollToLoadLazy, settlePage } from '@/lib/scrape/page-ready';
import { removeCaptureOverlay, showCaptureOverlay } from '@/lib/scrape/user-gate-overlay';
import { urlsMatch } from '@/lib/url/match';
import { cn } from '@/lib/utils';
import { useScrapeQueueView } from '@/state/scrape-queue-view';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Skull,
  Sparkles,
  Square,
  Target,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

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

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['success', 'thin', 'completed']);

/**
 * Auto-capturable buckets (no user interaction needed): L1/L2 + low-value.
 * L3 / gated_login need the overlay flow, so they're excluded from batch capture.
 * Module-scoped → stable identity (no useMemo dep churn).
 */
const isAutoCapturable = (b: BucketKey): boolean =>
  b === 'level_1_quick' || b === 'level_2_scroll' || b === 'low_value';

export function TasksView() {
  const queryClient = useQueryClient();
  const activeTab = useActiveTab();
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
    gated_login: true,
    // Low-value sources are opt-in — collapsed by default so they never read as
    // work the user should do (§5).
    low_value: false,
  });
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    succeeded: number;
    failed: number;
  } | null>(null);
  const batchRunning = batchProgress !== null;

  // Filter / search / sort / group state (persisted across reopens).
  const { filters, sort, groupMode } = useScrapeQueueView();
  // Multi-select for batch actions — keys are itemKey(item).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Selection-based batch (verdict / capture) progress, separate from the
  // automated runBatch progress.
  const [batchOp, setBatchOp] = useState<BatchProgress | null>(null);

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
      // gated_login (§5) sources also use the user-gated overlay flow — open,
      // let the user confirm they're signed in, then Go — so search both buckets.
      const item = [...q.level_3_user_gated, ...q.gated_login].find(
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

  const invalidateQueue = () => queryClient.invalidateQueries({ queryKey: ['scrape-queue'] });

  /** Capture flow for Level 1 / 2 / 3. Level 4 (paste) goes through `runPaste`. */
  const runAutomated = async (
    item: ExtensionScrapeItem,
    level: SubmittableLevel,
  ): Promise<{ ok: boolean; isGood: boolean }> => {
    const id = itemKey(item);
    const wantsActiveTab = level === 3;

    // Reuse the active tab if the user is RIGHT NOW on this URL. Re-query
    // instead of trusting the render-closure `activeTab` — a batch runs for
    // minutes, and the stale snapshot let the loop scrape whatever page the
    // user had wandered to and submit it as content for the queued URL.
    let liveActive: chrome.tabs.Tab | undefined;
    try {
      [liveActive] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch {
      /* fall through — no reuse */
    }
    const reuseActive =
      liveActive?.id != null && liveActive.url != null && urlsMatch(liveActive.url, item.url);

    setItemState(id, { status: 'navigating' });
    let tabId: number;
    if (reuseActive) {
      tabId = liveActive!.id!;
      if (wantsActiveTab) {
        try {
          await chrome.tabs.update(tabId, { active: true });
        } catch {
          /* tab may have closed mid-click */
        }
      }
    } else {
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
      tabId = tab.id;
      await waitForTab(tabId);
    }

    // Skip the auto-settle/scroll when reusing the active tab — the user is
    // already looking at the page; jumping the scroll would be jarring.
    if (level >= 2 && !reuseActive) {
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
  const runUserPreDecided = async (item: ExtensionScrapeItem, verdict: 'dead_link' | 'gated') => {
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
    // Close the tab on EVERY exit when we created it (batch path) — failed
    // captures used to bail before the remove and leaked one orphan
    // background tab per failure.
    const closeTab = async () => {
      if (keepTabOpen) return;
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* ignore */
      }
    };
    setItemState(id, { status: 'scraping', tabId });
    let html: string;
    try {
      html = await getOuterHtml(tabId);
    } catch (err) {
      setItemState(id, { status: 'error', error: (err as Error).message });
      await closeTab();
      return { ok: false, isGood: false };
    }

    // Browser-measured page data from the same loaded DOM, in one injection:
    // image dims (naturalWidth/Height), JS-injected media, and clean structured
    // data (OG/JSON-LD) the server's HTML scan can't compute. Sent alongside the
    // HTML so the gallery + structured fields are exact. Best-effort — empty on
    // failure (the server still derives everything from the HTML). §4.
    const page = await getCapturePageData(tabId);

    setItemState(id, { status: 'submitting', tabId });
    const result = await submitExtensionContent(
      item.topic_id,
      item.source_id,
      html,
      level,
      page.images,
      {
        media: { videos: page.videos, audio: page.audio },
        structured: { metadata: page.metadata, jsonLd: page.jsonLd },
      },
    );
    if (!result.ok) {
      setItemState(id, { status: 'error', error: result.error });
      await closeTab();
      return { ok: false, isGood: false };
    }

    await closeTab();

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

  /**
   * Run an `enrich` task (§3) — open/reuse the tab, fulfil the directive via the
   * existing capture primitives (settle/scroll/click → capture → submit with
   * enrich_goal), then close any tab we opened. Dormant until the server emits
   * `task_kind:'enrich'` items, but fully wired.
   */
  const runEnrichItem = async (item: ExtensionScrapeItem) => {
    const id = itemKey(item);
    if (!item.enrich) return;

    const reuseActive =
      activeTab.id != null && activeTab.url != null && urlsMatch(activeTab.url, item.url);
    setItemState(id, { status: 'navigating' });
    let tabId: number;
    let openedTab = false;
    if (reuseActive && activeTab.id != null) {
      tabId = activeTab.id;
    } else {
      let tab: chrome.tabs.Tab;
      try {
        tab = await chrome.tabs.create({ url: item.url, active: false });
      } catch (err) {
        setItemState(id, { status: 'error', error: (err as Error).message });
        return;
      }
      if (!tab.id) {
        setItemState(id, { status: 'error', error: 'Tab has no id' });
        return;
      }
      tabId = tab.id;
      openedTab = true;
      await waitForTab(tabId);
    }

    setItemState(id, { status: 'scraping', tabId });
    const outcome = await runEnrich(item, tabId);
    if (openedTab) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* ignore */
      }
    }
    if (!outcome.ok) {
      setItemState(id, { status: 'error', error: outcome.reason });
      return;
    }
    setItemState(id, {
      status: outcome.isGood ? 'success' : 'thin',
      charCount: outcome.charCount,
    });
    void invalidateQueue();
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
    setStatusByItem((s) => ({
      ...s,
      [id]: { ...prev, status: prev?.status ?? 'idle', verdictPending: verdict },
    }));
    const r = await applyVerdict(item.topic_id, item.source_id, verdict);
    if (!r.ok) {
      // MERGE, don't replace — replacing dropped showVerdictCard/preview/
      // charCount, vaporizing the whole card on a transient network error.
      setStatusByItem((s) => ({
        ...s,
        [id]: { ...s[id], status: 'error', error: r.error, verdictPending: undefined },
      }));
      return;
    }
    // The in-page overlay (if this item had one) is now orphaned — its item
    // left the queue, so its buttons would silently dead-end. Tear it down.
    const overlayTab = statusRef.current[id]?.tabId;
    if (overlayTab != null) void removeCaptureOverlay(overlayTab);
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
   * Run automated batch — the currently-visible Level 1 + Level 2 items
   * sequentially (so a project/domain filter scopes the batch). Skips items
   * already in a running or terminal state from this session.
   */
  const runBatch = async () => {
    const targets = automatedTargets
      .map((f) => ({ item: f.item, level: BUCKET_LEVEL[f.bucket] as SubmittableLevel }))
      .filter(({ item }) => {
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

  /**
   * Batch verdict — apply one verdict to every selected source via the bulk
   * endpoint (with a per-source fallback until it deploys). Terminal verdicts
   * drop the sources from the queue on the next refresh.
   */
  const runBatchVerdict = async (verdict: UserVerdict) => {
    const chosen = selectedItems;
    if (chosen.length === 0) return;
    const items: BulkVerdictItem[] = chosen.map((f) => ({
      topicId: f.item.topic_id,
      sourceId: f.item.source_id,
    }));
    const label = `Applying "${VERDICT_SHORT[verdict]}"…`;
    setBatchOp({ done: 0, total: items.length, label });
    try {
      const result = await applyVerdictBulk(items, verdict, undefined, (done, total) =>
        setBatchOp({ done, total, label }),
      );
      // Tear down verdict cards / pins for sources that resolved.
      const resolvedKeys = new Set(
        chosen.filter((f) => result.succeeded.includes(f.item.source_id)).map((f) => f.key),
      );
      if (resolvedKeys.size > 0) {
        setPinnedL3((p) => {
          let changed = false;
          const next: Record<string, ExtensionScrapeItem> = {};
          for (const [k, v] of Object.entries(p)) {
            if (resolvedKeys.has(k)) changed = true;
            else next[k] = v;
          }
          return changed ? next : p;
        });
      }
      if (result.failed.length > 0) {
        console.warn(
          `[matrx-extend] batch verdict: ${result.failed.length}/${items.length} failed`,
          result.failed,
        );
      }
    } finally {
      setBatchOp(null);
      // Keep only the sources that failed selected, so the user can see + retry.
      clearSelection();
      void invalidateQueue();
    }
  };

  /** Batch capture — run the auto-capturable selected sources (L1/L2/low-value). */
  const runBatchCapture = async () => {
    const targets = capturableSelected;
    if (targets.length === 0) return;
    setBatchOp({ done: 0, total: targets.length, label: 'Capturing…' });
    try {
      let done = 0;
      for (const f of targets) {
        const level = Math.min(BUCKET_LEVEL[f.bucket], 3) as SubmittableLevel;
        // eslint-disable-next-line no-await-in-loop
        await runAutomated(f.item, level);
        done++;
        setBatchOp({ done, total: targets.length, label: 'Capturing…' });
      }
    } finally {
      setBatchOp(null);
      clearSelection();
    }
  };

  // ── Queue view model: flatten → filter/search/sort → group ────────────────
  // Re-pin any open-verdict L3 sources onto the L3 bucket so the row hosting the
  // verdict card never vanishes when the server advances it to L4 mid-decision.
  const flat = useMemo<FlatQueueItem[]>(() => {
    const base = flattenQueue(queue);
    const pinnedKeys = new Set(Object.keys(pinnedL3));
    if (pinnedKeys.size === 0) return base;
    const out = base.map((f) =>
      pinnedKeys.has(f.key) ? { ...f, bucket: 'level_3_user_gated' as BucketKey } : f,
    );
    const present = new Set(out.map((f) => f.key));
    for (const [key, it] of Object.entries(pinnedL3)) {
      if (!present.has(key)) {
        out.push({ item: it, bucket: 'level_3_user_gated', key, domain: domainOf(it.url) });
      }
    }
    return out;
  }, [queue, pinnedL3]);

  const facets = useMemo(() => computeFacets(flat), [flat]);
  const visible = useMemo(() => filterAndSort(flat, filters, sort), [flat, filters, sort]);
  const groups = useMemo(() => buildGroups(visible, groupMode), [visible, groupMode]);
  const visibleKeys = useMemo(() => visible.map((f) => f.key), [visible]);

  const totalAll = flat.length;
  const allQueueItems = useMemo(() => flat.map((f) => f.item), [flat]);

  // "Run automated batch" targets — respect the active filter so a project-
  // scoped view batches only that project.
  const automatedTargets = useMemo(
    () => visible.filter((f) => f.bucket === 'level_1_quick' || f.bucket === 'level_2_scroll'),
    [visible],
  );
  const totalAutomated = automatedTargets.length;

  // ── Selection ─────────────────────────────────────────────────────────────
  const selectedItems = useMemo(() => flat.filter((f) => selected.has(f.key)), [flat, selected]);
  const capturableSelected = useMemo(
    () => selectedItems.filter((f) => isAutoCapturable(f.bucket)),
    [selectedItems],
  );
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));

  const toggleSelect = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setKeysSelected = (keys: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  const toggleSelectAllVisible = () => setKeysSelected(visibleKeys, !allVisibleSelected);
  const clearSelection = () => setSelected(new Set());

  // Prune selection of keys no longer present (queue refreshed, items resolved).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(flat.map((f) => f.key));
      const next = new Set([...prev].filter((k) => present.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [flat]);

  // Items in the queue that match the URL the user is currently viewing.
  // Used to surface a top-of-list banner so they don't have to hunt the row
  // out of a long queue, and so Run/Trigger reuses the active tab instead
  // of opening a duplicate.
  const matchingItems = useMemo(() => {
    if (!queue || !activeTab.url) return [];
    const all = [
      ...queue.level_1_quick,
      ...queue.level_2_scroll,
      ...queue.level_3_user_gated,
      ...queue.level_4_paste,
      ...queue.gated_login,
      ...queue.low_value,
    ];
    return all.filter((it) => urlsMatch(it.url, activeTab.url));
  }, [queue, activeTab.url]);
  const matchingIds = useMemo(() => new Set(matchingItems.map(itemKey)), [matchingItems]);

  const toggleSection = (k: string) => setOpenSections((s) => ({ ...s, [k]: !s[k] }));
  // Group open by default, except low-value (opt-in). Project groups (topic ids)
  // default open too.
  const isGroupOpen = (id: string) => openSections[id] ?? id !== 'low_value';

  /** Render one flat item as a PasteRow (L4) or Row (everything else). */
  const renderItem = (f: FlatQueueItem) => {
    const id = f.key;
    const isOnPage = matchingIds.has(id);
    if (f.bucket === 'level_4_paste') {
      return (
        <PasteRow
          key={id}
          item={f.item}
          state={statusByItem[id]}
          isOnPage={isOnPage}
          value={pasteByItem[id] ?? ''}
          onChange={(v) => setPasteByItem((p) => ({ ...p, [id]: v }))}
          onSubmit={() => void runPaste(f.item)}
          onVerdict={(v) => void runVerdict(f.item, v)}
          selected={selected.has(id)}
          onToggleSelect={() => toggleSelect(id)}
        />
      );
    }
    const rowLevel = Math.min(BUCKET_LEVEL[f.bucket], 3) as 1 | 2 | 3;
    return (
      <Row
        key={id}
        item={f.item}
        level={rowLevel}
        bucket={f.bucket}
        showLevel={groupMode === 'project'}
        state={statusByItem[id]}
        isOnPage={isOnPage}
        onRun={() => void runAutomated(f.item, rowLevel)}
        onUserGo={() => void runUserGo(f.item)}
        onEnrich={() => void runEnrichItem(f.item)}
        onVerdict={(v) => void runVerdict(f.item, v)}
        selected={selected.has(id)}
        onToggleSelect={() => toggleSelect(id)}
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Scrape queue</span>
        {queue && <span className="ml-1.5 text-xs text-muted-foreground">{totalAll}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          {queue && totalAll > 0 && (
            <CopyMenu
              title="Copy queue"
              options={[
                {
                  label: 'URLs (one per line)',
                  getContent: () => allQueueItems.map((it) => it.url).join('\n'),
                },
                {
                  label: 'For AI agent',
                  ai: true,
                  getContent: () => {
                    const all = allQueueItems;
                    return wrapForAgent({
                      description: 'a queue of pending scrape tasks from Matrx',
                      meta: { count: all.length },
                      format: 'text',
                      content: all
                        .map((it) => `- ${it.topic_name ?? it.topic_id}\n  ${it.url}`)
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
          <AddToProjectButton url={activeTab.url} title={activeTab.title} variant="icon" />
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

      {queue && totalAll > 0 && (
        <QueueToolbar facets={facets} filteredCount={visible.length} totalCount={totalAll} />
      )}

      <QueueSelectionBar
        selectedCount={selected.size}
        filteredCount={visible.length}
        allFilteredSelected={allVisibleSelected}
        capturableCount={capturableSelected.length}
        busy={batchOp !== null}
        progress={batchOp}
        onToggleSelectAll={toggleSelectAllVisible}
        onClear={clearSelection}
        onCapture={() => void runBatchCapture()}
        onVerdict={(v) => void runBatchVerdict(v)}
      />

      {matchingItems.length > 0 && (
        <ActiveTabMatchBanner
          items={matchingItems}
          onCapture={(it) => {
            const lvl = it.next_level;
            if (lvl === 4) return;
            void runAutomated(it, lvl as SubmittableLevel);
          }}
          onVerdict={(it, v) => void runVerdict(it, v)}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-3 px-3 pb-3">
          {/* CLAUDE.md item #6 — live status for `parallel_for_each_tab`
              orchestrations. Self-hides when no sessions exist. */}
          <ParallelRunsPanel />
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

          {queue && totalAll > 0 && visible.length === 0 && !error && (
            <div className="grid place-items-center px-4 py-12 text-center text-sm text-muted-foreground">
              No sources match your filters.
            </div>
          )}

          {groups.map((group) => {
            const groupKeys = group.items.map((f) => f.key);
            const selCount = groupKeys.filter((k) => selected.has(k)).length;
            const selectState =
              selCount === 0 ? 'none' : selCount === groupKeys.length ? 'all' : 'some';
            return (
              <Section
                key={group.id}
                title={group.label}
                subtitle={group.subtitle}
                count={group.items.length}
                tone={group.tone}
                open={isGroupOpen(group.id)}
                onToggle={() => toggleSection(group.id)}
                selectState={selectState}
                onToggleSelect={() => setKeysSelected(groupKeys, selectState !== 'all')}
              >
                {group.items.map(renderItem)}
              </Section>
            );
          })}
        </div>
      </div>

      {totalAutomated > 0 && (
        <div className="shrink-0 px-3 pb-3 pt-1">
          <Button
            onClick={() => void runBatch()}
            disabled={batchRunning || batchOp !== null}
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

/**
 * Sticky-ish banner shown when the active tab URL matches a queued source.
 * Tells the user "you're on a queued page" with quick actions, so they don't
 * have to hunt for the row in a long list. Multiple matches are unusual but
 * possible (same URL added to two topics) — we render one card per match.
 */
function ActiveTabMatchBanner({
  items,
  onCapture,
  onVerdict,
}: {
  items: ExtensionScrapeItem[];
  onCapture: (item: ExtensionScrapeItem) => void;
  onVerdict: (item: ExtensionScrapeItem, verdict: UserVerdict) => void;
}) {
  return (
    <div className="shrink-0 space-y-1.5 border-b border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
      {items.map((it) => {
        const lvl = it.next_level;
        const ctaLabel =
          lvl === 4 ? 'Use paste' : lvl === 3 ? 'Capture this tab' : 'Capture this tab';
        return (
          <div key={`${it.topic_id}:${it.source_id}`} className="flex items-center gap-2">
            <Target className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-emerald-800 dark:text-emerald-200">
                You're on a queued source — {it.topic_name}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {lvl === 4
                  ? 'L4 paste — copy the content and paste it in the row below.'
                  : `Ready to capture at L${lvl} without opening a new tab.`}
              </div>
            </div>
            {lvl !== 4 && (
              <Button
                size="sm"
                className="h-7 rounded-full bg-emerald-600 px-3 text-xs hover:bg-emerald-700"
                onClick={() => onCapture(it)}
              >
                {ctaLabel}
              </Button>
            )}
            <ResolveMenu
              onVerdict={(v) => onVerdict(it, v)}
              includeRetry={it.attempted_levels.length > 0}
            />
          </div>
        );
      })}
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
  selectState,
  onToggleSelect,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  tone?: 'amber';
  /** Select-all-in-group tri-state. Omit to hide the group checkbox. */
  selectState?: 'none' | 'some' | 'all';
  onToggleSelect?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-secondary/40',
          tone === 'amber' && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {onToggleSelect && (
          <button
            type="button"
            onClick={onToggleSelect}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title={selectState === 'all' ? 'Deselect group' : 'Select all in group'}
          >
            {selectState === 'all' ? (
              <CheckSquare className="size-4 text-primary" />
            ) : selectState === 'some' ? (
              <CheckSquare className="size-4 opacity-60" />
            ) : (
              <Square className="size-4" />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center justify-between text-left"
        >
          <div className="min-w-0">
            <div className="font-medium text-sm">
              {title}
              <span className="ml-1.5 text-muted-foreground text-xs">{count}</span>
            </div>
            {subtitle && <div className="truncate text-muted-foreground text-xs">{subtitle}</div>}
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
          />
        </button>
      </div>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

/** Row/paste-row selection checkbox. Renders nothing when selection is disabled. */
function SelectCheckbox({ checked, onToggle }: { checked: boolean; onToggle?: () => void }) {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      title={checked ? 'Deselect' : 'Select'}
      aria-pressed={checked}
    >
      {checked ? (
        <CheckSquare className="size-4 text-primary" />
      ) : (
        <Square className="size-4 opacity-50 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

function Row({
  item,
  level,
  bucket,
  showLevel,
  state,
  isOnPage,
  onRun,
  onUserGo,
  onEnrich,
  onVerdict,
  selected,
  onToggleSelect,
}: {
  item: ExtensionScrapeItem;
  level: 1 | 2 | 3;
  bucket: BucketKey;
  /** Show a capture-level chip — useful in project grouping where levels mix. */
  showLevel?: boolean;
  state?: ItemState;
  isOnPage?: boolean;
  onRun: () => void;
  onUserGo?: () => void;
  onEnrich?: () => void;
  onVerdict: (verdict: UserVerdict) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const status = state?.status ?? 'idle';
  const errorMsg = state?.error;
  const charCount = state?.charCount;
  const showVerdictCard = state?.showVerdictCard === true;
  // §3 — an enrich task gets a goal-specific action instead of plain Run/Trigger.
  const isEnrich = item.task_kind === 'enrich' && !!item.enrich;

  return (
    <div
      className={cn(
        'group rounded-xl bg-secondary/40 px-3 py-2.5 transition-colors hover:bg-secondary/70',
        isOnPage && 'bg-emerald-500/10 ring-1 ring-emerald-500/40 hover:bg-emerald-500/15',
        selected && 'bg-primary/10 ring-1 ring-primary/40 hover:bg-primary/15',
      )}
    >
      <div className="flex items-start gap-2">
        <SelectCheckbox checked={!!selected} onToggle={onToggleSelect} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="truncate text-sm font-medium">{item.topic_name}</div>
            {showLevel && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-secondary px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                {BUCKET_LABELS[bucket]}
              </span>
            )}
            {isOnPage && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <Target className="size-2.5" /> on this page
              </span>
            )}
            <PolicyBadge category={item.policy_category} />
            <EnrichBadge item={item} />
          </div>
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
          {(status === 'idle' || status === 'error') &&
            (isEnrich ? (
              <Button
                size="sm"
                variant="default"
                className="h-7 rounded-full bg-violet-600 px-3 text-xs hover:bg-violet-700"
                onClick={onEnrich}
                title={item.enrich ? ENRICH_GOAL_INFO[item.enrich.goal].blurb : undefined}
              >
                <Wand2 className="size-3.5" /> Enrich
              </Button>
            ) : (
              <Button
                size="sm"
                variant={level === 3 || isOnPage ? 'default' : 'ghost'}
                className="h-7 rounded-full px-3 text-xs"
                onClick={onRun}
                title={isOnPage ? 'Capture the active tab' : undefined}
              >
                {isOnPage ? 'Capture this tab' : level === 3 ? 'Trigger' : 'Run'}
              </Button>
            ))}
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

/**
 * Small chip showing the domain-policy category (§5). Renders nothing for the
 * default `open` (or absent) category — only the deliberately-routed ones get a
 * badge so the user knows why a source is treated specially.
 */
function PolicyBadge({ category }: { category?: PolicyCategory | null }) {
  if (!category || category === 'open') return null;
  const MAP: Record<
    Exclude<PolicyCategory, 'open'>,
    { icon: typeof Lock; label: string; cls: string }
  > = {
    gated_login: {
      icon: LogIn,
      label: 'Login required',
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    },
    low_value: {
      icon: EyeOff,
      label: 'Low-value',
      cls: 'bg-muted text-muted-foreground',
    },
    special: {
      icon: Sparkles,
      label: 'Worth it',
      cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    },
    blocked: {
      icon: Lock,
      label: 'Blocked',
      cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    },
  };
  const m = MAP[category];
  if (!m) return null;
  const Icon = m.icon;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider',
        m.cls,
      )}
    >
      <Icon className="size-2.5" /> {m.label}
    </span>
  );
}

/** Chip showing an enrich task's goal (§3). Nothing for plain scrape tasks. */
function EnrichBadge({ item }: { item: ExtensionScrapeItem }) {
  if (item.task_kind !== 'enrich' || !item.enrich) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-violet-700 dark:text-violet-300">
      <Wand2 className="size-2.5" /> {ENRICH_GOAL_INFO[item.enrich.goal].label}
    </span>
  );
}

function PasteRow({
  item,
  state,
  isOnPage,
  value,
  onChange,
  onSubmit,
  onVerdict,
  selected,
  onToggleSelect,
}: {
  item: ExtensionScrapeItem;
  state?: ItemState;
  isOnPage?: boolean;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onVerdict: (verdict: UserVerdict) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const status = state?.status ?? 'idle';
  const errorMsg = state?.error;
  const charCount = state?.charCount;
  const submitting = status === 'submitting';
  const done = status === 'success' || status === 'completed';

  return (
    <div
      className={cn(
        'group space-y-2 rounded-xl bg-secondary/40 px-3 py-2.5',
        isOnPage && 'bg-emerald-500/10 ring-1 ring-emerald-500/40',
        selected && 'bg-primary/10 ring-1 ring-primary/40',
      )}
    >
      <div className="flex items-start gap-2">
        <SelectCheckbox checked={!!selected} onToggle={onToggleSelect} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="truncate text-sm font-medium">{item.topic_name}</div>
            {isOnPage && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <Target className="size-2.5" /> on this page
              </span>
            )}
            <PolicyBadge category={item.policy_category} />
            <EnrichBadge item={item} />
          </div>
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
  // Server line — every item here has been tried by the server and given up
  // on (server_gave_up = true by queue contract), so this is always shown.
  const serverBits: string[] = [`server tried ${item.server_attempts}×`];
  if (item.last_server_attempt_at) {
    const ago = relativeTime(item.last_server_attempt_at);
    if (ago) serverBits.push(ago);
  }

  // Extension line — only appears once the user has triggered a capture.
  const extBits: string[] = [];
  if (item.attempted_levels && item.attempted_levels.length > 0) {
    extBits.push(`tried L${item.attempted_levels.join(', L')}`);
  }
  if (item.last_char_count != null) {
    extBits.push(`${item.last_char_count.toLocaleString()} chars`);
  }
  if (item.last_attempt_at) {
    const ago = relativeTime(item.last_attempt_at);
    if (ago) extBits.push(ago);
  }

  // §5/§3 — the human reason the source is routed specially (policy) or what the
  // enrich task is after. Shown above the attempt history.
  const policyReason = item.policy_reason?.trim() || null;
  const enrichReason =
    item.task_kind === 'enrich' && item.enrich
      ? item.enrich.reason?.trim() || ENRICH_GOAL_INFO[item.enrich.goal].blurb
      : null;

  return (
    <div className="mt-0.5 space-y-0.5">
      {policyReason && (
        <div className="truncate text-[11px] font-medium text-amber-700/80 dark:text-amber-300/80">
          {policyReason}
        </div>
      )}
      {enrichReason && (
        <div className="truncate text-[11px] text-violet-700/80 dark:text-violet-300/80">
          {enrichReason}
        </div>
      )}
      <div
        className="truncate text-[11px] text-muted-foreground/70"
        title={item.last_server_failure_reason ?? undefined}
      >
        {serverBits.join(' · ')}
        {item.last_server_failure_reason && (
          <span className="text-muted-foreground/55">
            {' — '}
            {item.last_server_failure_reason}
          </span>
        )}
      </div>
      {extBits.length > 0 && (
        <div
          className="truncate text-[11px] text-muted-foreground/60"
          title={item.last_failure_reason ?? undefined}
        >
          extension: {extBits.join(' · ')}
          {item.last_failure_reason && (
            <span className="text-muted-foreground/45">
              {' — '}
              {item.last_failure_reason}
            </span>
          )}
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
        <AlertTriangle className="size-3.5" /> error
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
      <PopoverContent align="end" className="w-72 p-1">
        {VERDICT_OPTIONS.filter((o) => !o.retryOnly || includeRetry).map((o) => (
          <VerdictMenuItem
            key={o.verdict}
            icon={o.icon}
            label={o.label}
            description={o.description}
            onClick={() => choose(o.verdict)}
          />
        ))}
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
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(check);
      chrome.tabs.onRemoved.removeListener(onGone);
      clearTimeout(timer);
    };
    const check = (id: number, change: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && change.status === 'complete') {
        cleanup();
        resolve();
      }
    };
    // Tab closed during load — resolve immediately (the caller's capture
    // will fail fast with a real error) instead of spinning the row on
    // "navigating" for the full 30s.
    const onGone = (id: number) => {
      if (id !== tabId) return;
      cleanup();
      resolve();
    };
    chrome.tabs.onUpdated.addListener(check);
    chrome.tabs.onRemoved.addListener(onGone);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 30_000);
  });
}
