import { CopyMenu } from '@/components/CopyMenu';
import { MarkdownView } from '@/components/MarkdownView';
import { fullCaptureCopyOptions } from '@/lib/scrape/copy-options';
import type { SoupResult } from '@/lib/scrape/pipeline';
import {
  type SavedCapture,
  type SavedCaptureSummary,
  getSavedCapture,
  listSavedCaptures,
  setSavedCaptureDeleted,
  updateSavedCapture,
} from '@/lib/supabase/queries';
import { useSidepanelTabStore } from '@/state/sidepanel-tab';
import {
  Button,
  ConfirmDialog,
  BasicInput as Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@ai-matrx/design-system';
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Library,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 40;

function captureTitle(capture: Pick<SavedCaptureSummary, 'title' | 'url'>): string {
  if (capture.title?.trim()) return capture.title.trim();
  try {
    return new URL(capture.url).hostname;
  } catch {
    return capture.url;
  }
}

function captureHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isSoupResult(value: unknown): value is SoupResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.url === 'string' &&
    row.article !== null &&
    typeof row.article === 'object' &&
    Array.isArray(row.images) &&
    Array.isArray(row.videos) &&
    Array.isArray(row.audio) &&
    Array.isArray(row.links)
  );
}

export function SavedCapturesView() {
  const [captures, setCaptures] = useState<SavedCaptureSummary[]>([]);
  const [selected, setSelected] = useState<SavedCapture | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SavedCaptureSummary | null>(null);
  const requestGeneration = useRef(0);
  const setTab = useSidepanelTabStore((state) => state.setTab);

  const load = useCallback(async (search = '') => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    try {
      const rows = await listSavedCaptures({ limit: PAGE_SIZE, search });
      if (generation !== requestGeneration.current) return;
      setCaptures(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setCaptures([]);
      setHasMore(false);
      setError(cause instanceof Error ? cause.message : 'Saved captures could not be loaded.');
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(query), query ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [load, query]);

  const openCapture = async (summary: SavedCaptureSummary) => {
    setLoading(true);
    setError(null);
    try {
      const capture = await getSavedCapture(summary.id);
      if (!capture) throw new Error('This saved capture no longer exists.');
      setSelected(capture);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The saved capture could not be opened.');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    const generation = requestGeneration.current;
    const lastCapture = captures.at(-1);
    if (!lastCapture) return;
    setLoadingMore(true);
    setError(null);
    try {
      const rows = await listSavedCaptures({
        limit: PAGE_SIZE,
        search: query,
        before: { captured_at: lastCapture.captured_at, id: lastCapture.id },
      });
      if (generation !== requestGeneration.current) return;
      setCaptures((current) => [...current, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setError(cause instanceof Error ? cause.message : 'More captures could not be loaded.');
    } finally {
      if (generation === requestGeneration.current) setLoadingMore(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setError(null);
    try {
      await setSavedCaptureDeleted(target.id, true);
      setCaptures((current) => current.filter((capture) => capture.id !== target.id));
      if (selected?.id === target.id) setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The capture could not be deleted.');
    }
  };

  if (selected) {
    return (
      <>
        <SavedCaptureDetail
          capture={selected}
          onBack={() => {
            setSelected(null);
            void load(query);
          }}
          onUpdated={(capture) => setSelected(capture)}
          onDelete={() => setDeleteTarget(selected)}
          error={error}
          setError={setError}
        />
        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title="Delete saved capture?"
          description="This removes it from your saved captures. The original web page is not affected."
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={() => void confirmDelete()}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Saved captures</h2>
            <p className="text-[11px] text-muted-foreground">Pages saved from Scrape</p>
          </div>
          <Button size="icon" variant="ghost" className="size-8" onClick={() => void load(query)}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            <span className="sr-only">Refresh saved captures</span>
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, URL, or description"
              className="h-8 rounded-full pl-8 text-sm"
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {error && <ErrorNotice message={error} onRetry={() => void load(query)} />}
        {loading && captures.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : error && captures.length === 0 ? null : captures.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Library className="size-8 text-muted-foreground/50" />
            <div>
              <p className="text-sm font-medium">
                {query ? 'No captures match your search' : 'No saved captures yet'}
              </p>
              {!query && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Capture a page in Scrape, then press Save.
                </p>
              )}
            </div>
            {!query && (
              <Button size="sm" className="rounded-full" onClick={() => setTab('scrape')}>
                Go to Scrape
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {captures.map((capture) => (
              <article
                key={capture.id}
                className="group rounded-xl border border-border bg-card p-3"
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => void openCapture(capture)}
                >
                  <div className="truncate text-sm font-medium">{captureTitle(capture)}</div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {captureHost(capture.url)} · {new Date(capture.captured_at).toLocaleString()}
                  </div>
                  {capture.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {capture.description}
                    </p>
                  )}
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {capture.media_count} media item{capture.media_count === 1 ? '' : 's'}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-destructive"
                      onClick={() => setDeleteTarget(capture)}
                    >
                      <Trash2 />
                      <span className="sr-only">Delete {captureTitle(capture)}</span>
                    </Button>
                  </div>
                </div>
              </article>
            ))}
            {hasMore && (
              <Button
                variant="secondary"
                className="w-full rounded-full"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore && <Loader2 className="animate-spin" />}
                Load more
              </Button>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete saved capture?"
        description="This removes it from your saved captures. The original web page is not affected."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function SavedCaptureDetail({
  capture,
  onBack,
  onUpdated,
  onDelete,
  error,
  setError,
}: {
  capture: SavedCapture;
  onBack: () => void;
  onUpdated: (capture: SavedCapture) => void;
  onDelete: () => void;
  error: string | null;
  setError: (error: string | null) => void;
}) {
  const soup = isSoupResult(capture.soup) ? capture.soup : null;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(capture.title ?? soup?.article.title ?? '');
  const [description, setDescription] = useState(capture.description ?? '');
  const [markdown, setMarkdown] = useState(
    capture.markdown ?? soup?.article.content_markdown ?? '',
  );

  const saveEdits = async () => {
    setSaving(true);
    setError(null);
    try {
      const wordCount = markdown.split(/\s+/).filter(Boolean).length;
      const nextSoup = soup
        ? {
            ...soup,
            metadata: {
              ...soup.metadata,
              title: title.trim() || null,
              description: description.trim() || null,
            },
            article: {
              ...soup.article,
              title: title.trim() || null,
              content_markdown: markdown || null,
              word_count: wordCount || null,
              reading_time_minutes: wordCount ? Math.max(1, Math.round(wordCount / 220)) : null,
            },
            seo: {
              ...soup.seo,
              word_count: wordCount,
            },
          }
        : capture.soup;
      const nextMetadata =
        capture.metadata && typeof capture.metadata === 'object'
          ? {
              ...capture.metadata,
              title: title.trim() || null,
              description: description.trim() || null,
            }
          : {
              title: title.trim() || null,
              description: description.trim() || null,
            };
      const updated = await updateSavedCapture({
        id: capture.id,
        expectedVersion: capture.version,
        title: title.trim() || null,
        description: description.trim() || null,
        markdown: markdown || null,
        soup: nextSoup,
        metadata: nextMetadata,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The capture could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-start gap-2">
          <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={onBack}>
            <ArrowLeft />
            <span className="sr-only">Back to saved captures</span>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{captureTitle(capture)}</div>
            <div className="truncate text-[11px] text-muted-foreground">{capture.url}</div>
          </div>
          {soup && <CopyMenu title="Copy capture" options={fullCaptureCopyOptions(soup)} />}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={() => void chrome.tabs.create({ url: capture.url })}
          >
            <ExternalLink /> Open page
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={() => setEditing((value) => !value)}
          >
            <Pencil /> {editing ? 'Cancel edit' : 'Edit'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 rounded-full px-2.5 text-xs text-destructive"
            onClick={onDelete}
          >
            <Trash2 /> Delete
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {error && <ErrorNotice message={error} />}
        {editing ? (
          <div className="space-y-3">
            <label htmlFor="saved-capture-title" className="block space-y-1">
              <span className="text-xs font-medium">Title</span>
              <Input
                id="saved-capture-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label htmlFor="saved-capture-description" className="block space-y-1">
              <span className="text-xs font-medium">Description</span>
              <textarea
                id="saved-capture-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label htmlFor="saved-capture-markdown" className="block space-y-1">
              <span className="text-xs font-medium">Article markdown</span>
              <textarea
                id="saved-capture-markdown"
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                rows={16}
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <Button
              className="w-full rounded-full"
              disabled={saving}
              onClick={() => void saveEdits()}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              Save changes
            </Button>
          </div>
        ) : soup ? (
          <Tabs defaultValue="article">
            <TabsList className="mb-3 bg-transparent p-0">
              <TabsTrigger value="article">Article</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
            </TabsList>
            <TabsContent value="article">
              {markdown ? (
                <MarkdownView content={markdown} />
              ) : (
                <EmptyDetail icon={FileText} text="This capture has no article text." />
              )}
            </TabsContent>
            <TabsContent value="details" className="space-y-3 text-xs">
              <DetailRow label="Captured" value={new Date(capture.captured_at).toLocaleString()} />
              <DetailRow label="Updated" value={new Date(capture.updated_at).toLocaleString()} />
              <DetailRow label="Language" value={capture.lang ?? 'Unknown'} />
              <DetailRow label="Words" value={String(soup.article.word_count ?? 0)} />
              <DetailRow label="Images" value={String(soup.images.length)} />
              <DetailRow label="Videos" value={String(soup.videos.length)} />
              <DetailRow label="Audio" value={String(soup.audio.length)} />
              <DetailRow label="Links" value={String(soup.links.length)} />
            </TabsContent>
            <TabsContent value="data">
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-secondary/40 p-3 text-[11px]">
                {JSON.stringify(capture.soup, null, 2)}
              </pre>
            </TabsContent>
          </Tabs>
        ) : (
          <EmptyDetail
            icon={FileText}
            text="This capture's stored page data could not be displayed."
          />
        )}
      </div>
    </div>
  );
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" className="h-7 rounded-full" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-words text-right">{value}</span>
    </div>
  );
}

function EmptyDetail({ icon: Icon, text }: { icon: typeof FileText; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
      <Icon className="size-6" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
