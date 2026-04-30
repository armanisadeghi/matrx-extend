import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type ExtensionScrapeItem,
  type ExtensionScrapeQueue,
  type SubmittableLevel,
  getExtensionScrapeQueue,
  markSourceComplete,
  submitExtensionContent,
  submitPasteContent,
} from '@/lib/api/routes/research';
import { getOuterHtml } from '@/lib/scrape/capture-html';
import { scrollToLoadLazy, settlePage } from '@/lib/scrape/page-ready';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  PlayCircle,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';

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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    level_1_quick: true,
    level_2_scroll: true,
    level_3_user_gated: true,
    level_4_paste: true,
  });
  const [batchRunning, setBatchRunning] = useState(false);

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

  // After every queue refresh, drop "thin" / "error" badges for items still in
  // the queue — the source has moved up the ladder, so it's effectively a fresh
  // attempt now and the Run button should reappear. Preserve `awaiting_user`
  // (mid-flow, has live tabId) and `success` / `completed` (terminal acks).
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
        if (liveIds.has(id) && (state.status === 'thin' || state.status === 'error')) {
          changed = true;
          continue;
        }
        next[id] = state;
      }
      return changed ? next : prev;
    });
  }, [queue]);

  const setItemState = (id: string, patch: ItemState) =>
    setStatusByItem((s) => ({ ...s, [id]: patch }));

  const invalidateQueue = () =>
    queryClient.invalidateQueries({ queryKey: ['scrape-queue'] });

  /** Capture flow for Level 1 / 2 / 3. Level 4 (paste) goes through `runPaste`. */
  const runAutomated = async (item: ExtensionScrapeItem, level: SubmittableLevel) => {
    const id = itemKey(item);
    const wantsActiveTab = level === 3;

    setItemState(id, { status: 'navigating' });
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.create({ url: item.url, active: wantsActiveTab });
    } catch (err) {
      setItemState(id, { status: 'error', error: (err as Error).message });
      return;
    }
    if (!tab.id) {
      setItemState(id, { status: 'error', error: 'Tab has no id' });
      return;
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
      // click "Go" — `runUserGo` finishes the flow.
      try {
        await chrome.tabs.update(tabId, { active: true });
      } catch {
        /* tab may have been closed */
      }
      setItemState(id, { status: 'awaiting_user', tabId });
      return;
    }

    await captureAndSubmit(item, level, tabId, /* keepTabOpen */ false);
  };

  const runUserGo = async (item: ExtensionScrapeItem) => {
    const id = itemKey(item);
    const tabId = statusByItem[id]?.tabId;
    if (tabId == null) {
      setItemState(id, { status: 'error', error: 'Tab is no longer open' });
      return;
    }
    await captureAndSubmit(item, 3, tabId, /* keepTabOpen */ true);
  };

  const captureAndSubmit = async (
    item: ExtensionScrapeItem,
    level: SubmittableLevel,
    tabId: number,
    keepTabOpen: boolean,
  ) => {
    const id = itemKey(item);
    setItemState(id, { status: 'scraping', tabId });
    let html: string;
    try {
      html = await getOuterHtml(tabId);
    } catch (err) {
      setItemState(id, { status: 'error', error: (err as Error).message });
      return;
    }

    setItemState(id, { status: 'submitting', tabId });
    const result = await submitExtensionContent(item.topic_id, item.source_id, html, level);
    if (!result.ok) {
      setItemState(id, { status: 'error', error: result.error });
      return;
    }

    if (!keepTabOpen) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* ignore */
      }
    }

    const { is_good_scrape, char_count, next_level } = result.data;
    setItemState(id, {
      status: is_good_scrape ? 'success' : 'thin',
      charCount: char_count,
      nextLevel: next_level ?? undefined,
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

  const runMarkComplete = async (item: ExtensionScrapeItem) => {
    const id = itemKey(item);
    const r = await markSourceComplete(item.topic_id, item.source_id);
    if (!r.ok) {
      setItemState(id, { status: 'error', error: r.error });
      return;
    }
    setItemState(id, { status: 'completed' });
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
    ];
    if (targets.length === 0) return;
    setBatchRunning(true);
    try {
      for (const { item, level } of targets) {
        const id = itemKey(item);
        const cur = statusByItem[id]?.status;
        if (cur && (RUNNING_STATUSES.has(cur) || TERMINAL_STATUSES.has(cur))) continue;
        // eslint-disable-next-line no-await-in-loop
        await runAutomated(item, level);
      }
    } finally {
      setBatchRunning(false);
    }
  };

  const totalAutomated =
    (queue?.level_1_quick.length ?? 0) + (queue?.level_2_scroll.length ?? 0);
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
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7 text-muted-foreground"
          onClick={() => void refetch()}
          title="Refresh"
          disabled={isFetching}
        >
          <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
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

          {queue && (queue.level_1_quick.length > 0 || queue.level_2_scroll.length > 0) && (
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
              {queue.level_1_quick.map((it) => (
                <Row
                  key={itemKey(it)}
                  item={it}
                  level={1}
                  state={statusByItem[itemKey(it)]}
                  onRun={() => void runAutomated(it, 1)}
                  onMarkComplete={() => void runMarkComplete(it)}
                />
              ))}
              {queue.level_2_scroll.map((it) => (
                <Row
                  key={itemKey(it)}
                  item={it}
                  level={2}
                  state={statusByItem[itemKey(it)]}
                  onRun={() => void runAutomated(it, 2)}
                  onMarkComplete={() => void runMarkComplete(it)}
                />
              ))}
            </Section>
          )}

          {queue && queue.level_3_user_gated.length > 0 && (
            <Section
              title="Needs your help"
              subtitle="Auto-scrape couldn't get past popups, login, or paywalls. Trigger one, click past the obstacle, then press Go."
              count={queue.level_3_user_gated.length}
              open={!!openSections.level_3_user_gated}
              onToggle={() => toggleSection('level_3_user_gated')}
              tone="amber"
            >
              {queue.level_3_user_gated.map((it) => (
                <Row
                  key={itemKey(it)}
                  item={it}
                  level={3}
                  state={statusByItem[itemKey(it)]}
                  onRun={() => void runAutomated(it, 3)}
                  onUserGo={() => void runUserGo(it)}
                  onMarkComplete={() => void runMarkComplete(it)}
                />
              ))}
            </Section>
          )}

          {queue && queue.level_4_paste.length > 0 && (
            <Section
              title="Manual paste"
              subtitle="Open the URL in a normal tab, copy the content, paste it here."
              count={queue.level_4_paste.length}
              open={!!openSections.level_4_paste}
              onToggle={() => toggleSection('level_4_paste')}
              tone="amber"
            >
              {queue.level_4_paste.map((it) => {
                const id = itemKey(it);
                return (
                  <PasteRow
                    key={id}
                    item={it}
                    state={statusByItem[id]}
                    value={pasteByItem[id] ?? ''}
                    onChange={(v) => setPasteByItem((p) => ({ ...p, [id]: v }))}
                    onSubmit={() => void runPaste(it)}
                    onMarkComplete={() => void runMarkComplete(it)}
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
            {batchRunning ? (
              <>
                <Loader2 className="animate-spin" /> Running batch…
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
  onMarkComplete,
}: {
  item: ExtensionScrapeItem;
  level: 1 | 2 | 3;
  state?: ItemState;
  onRun: () => void;
  onUserGo?: () => void;
  onMarkComplete: () => void;
}) {
  const status = state?.status ?? 'idle';
  const errorMsg = state?.error;
  const charCount = state?.charCount;

  return (
    <div className="rounded-xl bg-secondary/40 px-3 py-2.5 transition-colors hover:bg-secondary/70">
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
        </div>
      </div>
      {errorMsg && <div className="mt-1.5 text-xs text-destructive">{errorMsg}</div>}
      {(status === 'idle' || status === 'error') && level >= 2 && (
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            onClick={onMarkComplete}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Mark as complete (no more content)
          </button>
        </div>
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
  onMarkComplete,
}: {
  item: ExtensionScrapeItem;
  state?: ItemState;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onMarkComplete: () => void;
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
        <Status status={status} charCount={charCount} />
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
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onMarkComplete}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              No more content available
            </button>
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
  if (bits.length === 0) return null;
  return (
    <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
      {bits.join(' · ')}
    </div>
  );
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
