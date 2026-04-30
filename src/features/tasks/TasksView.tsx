import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  ListTodo,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { sendMessage } from 'webext-bridge/window';

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

    // Wait for the tab to finish loading. status === 'complete'
    await waitForTab(tab.id);

    setStatusByItem((s) => ({ ...s, [id]: { status: 'scraping' } }));
    try {
      const soup = (await sendMessage(
        CHANNELS.SCRAPE_CAPTURE as never,
        { tabId: tab.id, options: {} } as never,
        `content-script@${tab.id}` as never,
      )) as unknown as SoupResult;

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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex items-center gap-2">
          <ListTodo className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Scrape queue</span>
          {items && <Badge variant="secondary">{items.length}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => void load()} title="Refresh">
            <RefreshCw className="size-4" />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void runAll()}
            disabled={!items?.length}
          >
            Run all
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {items === null && !error && (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="size-4" /> {error}
            </div>
          )}
          {items && items.length === 0 && (
            <div className="grid place-items-center py-12 text-sm text-muted-foreground">
              Nothing in the queue. Add tasks from the Matrx app.
            </div>
          )}
          {items?.map((it) => {
            const id = `${it.topic_id}:${it.source_id}`;
            const status = statusByItem[id]?.status ?? 'idle';
            const errorMsg = statusByItem[id]?.error;
            return (
              <div key={id} className="rounded-lg border bg-card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{it.topic_name ?? it.topic_id}</div>
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-muted-foreground hover:underline"
                    >
                      {it.url}
                    </a>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Status status={status} />
                    {status === 'idle' || status === 'error' ? (
                      <Button size="sm" variant="outline" onClick={() => void runOne(it)}>
                        Run
                      </Button>
                    ) : null}
                  </div>
                </div>
                {errorMsg && <div className="mt-2 text-xs text-destructive">{errorMsg}</div>}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function Status({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'idle':
      return null;
    case 'navigating':
    case 'scraping':
    case 'submitting':
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="size-3 animate-spin" /> {status}
        </Badge>
      );
    case 'success':
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="size-3" /> done
        </Badge>
      );
    case 'error':
      return (
        <Badge variant="destructive" className="gap-1">
          <ExternalLink className="size-3" /> error
        </Badge>
      );
  }
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
    // Safety timeout — don't hang forever.
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(check);
      resolve();
    }, 30_000);
  });
}
