import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type ScrapeQueueItem,
  getExtensionScrapeQueue,
  submitExtensionContent,
} from '@/lib/api/routes/research';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { SoupResult } from '@/lib/scrape/pipeline';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlayCircle,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';

type TaskStatus = 'idle' | 'navigating' | 'scraping' | 'submitting' | 'success' | 'error';

export function TasksView() {
  const [items, setItems] = useState<ScrapeQueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusByItem, setStatusByItem] = useState<
    Record<string, { status: TaskStatus; error?: string }>
  >({});

  const load = async () => {
    setError(null);
    setItems(null);
    const r = await getExtensionScrapeQueue();
    if (r.ok) setItems(r.data);
    else setError(r.error);
  };

  useEffect(() => {
    void load();
  }, []);

  const runOne = async (item: ScrapeQueueItem) => {
    const id = `${item.topic_id}:${item.source_id}`;
    setStatusByItem((s) => ({ ...s, [id]: { status: 'navigating' } }));

    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.create({ url: item.url, active: true });
    } catch (err) {
      setStatusByItem((s) => ({ ...s, [id]: { status: 'error', error: (err as Error).message } }));
      return;
    }
    if (!tab.id) {
      setStatusByItem((s) => ({ ...s, [id]: { status: 'error', error: 'Tab has no id' } }));
      return;
    }

    await waitForTab(tab.id);

    setStatusByItem((s) => ({ ...s, [id]: { status: 'scraping' } }));
    try {
      const soup = (await chrome.tabs.sendMessage(tab.id, {
        __matrx: true,
        kind: CHANNELS.SCRAPE_CAPTURE,
        payload: { options: {} },
      })) as SoupResult;

      setStatusByItem((s) => ({ ...s, [id]: { status: 'submitting' } }));
      const html = soup.article.content_html_safe ?? '';
      const result = await submitExtensionContent(item.topic_id, item.source_id, html);
      if (!result.ok) throw new Error(result.error);
      setStatusByItem((s) => ({ ...s, [id]: { status: 'success' } }));
    } catch (err) {
      setStatusByItem((s) => ({ ...s, [id]: { status: 'error', error: (err as Error).message } }));
    }
  };

  const runAll = async () => {
    if (!items) return;
    for (const item of items) {
      const id = `${item.topic_id}:${item.source_id}`;
      if (statusByItem[id]?.status === 'success') continue;
      // eslint-disable-next-line no-await-in-loop
      await runOne(item);
    }
  };

  const anyRunning = Object.values(statusByItem).some(
    (s) => s.status === 'navigating' || s.status === 'scraping' || s.status === 'submitting',
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">Scrape queue</span>
        {items && (
          <span className="ml-1.5 text-xs text-muted-foreground">{items.length}</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7 text-muted-foreground"
          onClick={() => void load()}
          title="Refresh"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1.5 px-3 pb-3">
          {items === null && !error && (
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
          {items && items.length === 0 && (
            <div className="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground">
              Nothing in the queue. Add tasks from the Matrx app.
            </div>
          )}
          {items?.map((it) => {
            const id = `${it.topic_id}:${it.source_id}`;
            const status = statusByItem[id]?.status ?? 'idle';
            const errorMsg = statusByItem[id]?.error;
            return (
              <div
                key={id}
                className="rounded-xl bg-secondary/40 px-3 py-2.5 transition-colors hover:bg-secondary/70"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {it.topic_name ?? it.topic_id}
                    </div>
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-muted-foreground hover:underline"
                    >
                      {it.url}
                    </a>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Status status={status} />
                    {(status === 'idle' || status === 'error') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-full px-3 text-xs"
                        onClick={() => void runOne(it)}
                      >
                        Run
                      </Button>
                    )}
                  </div>
                </div>
                {errorMsg && <div className="mt-1.5 text-xs text-destructive">{errorMsg}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1">
        <Button
          onClick={() => void runAll()}
          disabled={!items?.length || anyRunning}
          className="w-full rounded-full"
        >
          {anyRunning ? (
            <>
              <Loader2 className="animate-spin" /> Running…
            </>
          ) : (
            <>
              <PlayCircle /> Run all
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Status({ status }: { status: TaskStatus }) {
  if (status === 'idle') return null;
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" /> done
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
