import { CopyMenu } from '@/components/CopyMenu';
import { MarkdownView } from '@/components/MarkdownView';
import { editSource } from '@/lib/api/routes/sources';
import { fullCaptureCopyOptions } from '@/lib/scrape/copy-options';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { portionsFromMarkdown } from '@/lib/sources/portions';
import { readCaptureOriginal } from '@/lib/sources/read-original';
import { sourceWebAppUrl } from '@/lib/sources/web-app-link';
import { isDbFailureError } from '@/lib/supabase/db-failure';
import {
  type SavedCapture,
  type SavedCaptureSummary,
  deleteSavedCapture,
  getSavedCapture,
  listSavedCaptures,
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

export function SavedCapturesView() {
  const [captures, setCaptures] = useState<SavedCaptureSummary[]>([]);
  const [selected, setSelected] = useState<SavedCapture | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SavedCaptureSummary | null>(null);
  /** Saved captures the database returned that could not be read — said, never hidden. */
  const [unreadable, setUnreadable] = useState(0);
  const requestGeneration = useRef(0);
  const setTab = useSidepanelTabStore((state) => state.setTab);

  const load = useCallback(async (search = '') => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    try {
      const page = await listSavedCaptures({ limit: PAGE_SIZE, search });
      if (generation !== requestGeneration.current) return;
      setCaptures(page.rows);
      setUnreadable(page.unreadable);
      setHasMore(page.fetched === PAGE_SIZE);
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      setCaptures([]);
      setUnreadable(0);
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
      const page = await listSavedCaptures({
        limit: PAGE_SIZE,
        search: query,
        before: { captured_at: lastCapture.captured_at, id: lastCapture.id },
      });
      if (generation !== requestGeneration.current) return;
      setCaptures((current) => {
        const seen = new Set(current.map((c) => c.id));
        return [...current, ...page.rows.filter((r) => !seen.has(r.id))];
      });
      setUnreadable((n) => n + page.unreadable);
      setHasMore(page.fetched === PAGE_SIZE);
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
      await deleteSavedCapture(target.id);
      setCaptures((current) => current.filter((capture) => capture.id !== target.id));
      if (selected?.id === target.id) setSelected(null);
    } catch (cause) {
      setError(
        isDbFailureError(cause)
          ? cause.userMessage
          : cause instanceof Error
            ? cause.message
            : 'The capture could not be deleted.',
      );
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
          description="This removes it from your saved captures and your Sources. The original web page is not affected."
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
            <p className="text-[11px] text-muted-foreground">
              Pages saved from Scrape, kept as Sources
            </p>
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
              placeholder="Search title or URL"
              className="h-8 rounded-full pl-8 text-sm"
            />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {error && <ErrorNotice message={error} onRetry={() => void load(query)} />}
        {unreadable > 0 && (
          <ErrorNotice
            message={`${unreadable} saved capture${unreadable === 1 ? '' : 's'} could not be read, so ${unreadable === 1 ? 'it is' : 'they are'} not shown. Refresh to try again.`}
            onRetry={() => void load(query)}
          />
        )}
        {loading && captures.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (error || unreadable > 0) && captures.length === 0 ? null : captures.length === 0 ? (
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
                    {captureHost(capture.url)}
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
        description="This removes it from your saved captures and your Sources. The original web page is not affected."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
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
  // The full SoupResult lives in S3 as the Source's original; the collectors
  // also ride on structured_json, so Details and Data still work when the
  // organization keeps text only (or while the original downloads).
  const [soup, setSoup] = useState<SoupResult | null>(null);
  const [originalState, setOriginalState] = useState<'loading' | 'ready' | 'none' | 'failed'>(
    capture.original_file_id ? 'loading' : 'none',
  );
  const [originalNote, setOriginalNote] = useState<string | null>(null);
  useEffect(() => {
    if (!capture.original_file_id) return;
    let alive = true;
    readCaptureOriginal(capture.original_file_id)
      .then((result) => {
        if (!alive) return;
        setSoup(result);
        setOriginalState('ready');
      })
      .catch((cause) => {
        if (!alive) return;
        setOriginalState('failed');
        setOriginalNote(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
    };
  }, [capture.original_file_id]);

  const structured = capture.structured ?? {};
  const metadata = (structured.metadata ?? {}) as Record<string, unknown>;
  const article = (structured.article ?? {}) as Record<string, unknown>;
  const text = capture.edited_content ?? soup?.article.content_markdown ?? capture.content ?? '';
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(text);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const beginEdit = () => {
    setDraft(text);
    setSavedNote(null);
    setEditing((value) => !value);
  };

  const saveEdits = async () => {
    const portions = portionsFromMarkdown(draft);
    if (portions.length === 0) {
      setError('The edit has no text in it, so there is nothing to save.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const outcome = await editSource(capture.id, portions);
      if (!outcome.ok) {
        setError(outcome.refusal.message);
        return;
      }
      const reloaded = await getSavedCapture(capture.id);
      if (!reloaded) throw new Error('This saved capture no longer exists.');
      setSavedNote(outcome.landed.notices.map((n) => n.message).join(' ') || null);
      onUpdated(reloaded);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The capture could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  const words =
    soup?.article.word_count ??
    (typeof article.word_count === 'number' ? article.word_count : null) ??
    text.split(/\s+/).filter(Boolean).length;
  const lang =
    soup?.metadata.lang ?? (typeof metadata.lang === 'string' ? metadata.lang : null) ?? 'Unknown';

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
            title="Opens this Source in the AI Matrx web app"
            onClick={() => void chrome.tabs.create({ url: sourceWebAppUrl(capture.id) })}
          >
            <Library /> Open in web app
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 rounded-full px-2.5 text-xs"
            onClick={beginEdit}
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
        {savedNote && !editing && (
          <div className="mb-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {savedNote}
          </div>
        )}
        {editing ? (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Your edit is saved as the version people read. The original capture is kept unchanged.
            </p>
            <label htmlFor="saved-capture-markdown" className="block space-y-1">
              <span className="text-xs font-medium">Article text</span>
              <textarea
                id="saved-capture-markdown"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
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
        ) : (
          <Tabs defaultValue="article">
            <TabsList className="mb-3 bg-transparent p-0">
              <TabsTrigger value="article">Article</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
            </TabsList>
            <TabsContent value="article">
              {capture.edited_content && (
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Showing your edited version. The original capture is kept unchanged.
                </p>
              )}
              {text ? (
                <MarkdownView content={text} />
              ) : (
                <EmptyDetail icon={FileText} text="This capture has no article text." />
              )}
            </TabsContent>
            <TabsContent value="details" className="space-y-3 text-xs">
              <DetailRow label="Captured" value={new Date(capture.captured_at).toLocaleString()} />
              <DetailRow label="Updated" value={new Date(capture.updated_at).toLocaleString()} />
              <DetailRow label="Language" value={lang} />
              <DetailRow label="Words" value={String(words ?? 0)} />
              <DetailRow
                label="Images"
                value={String(soup?.images.length ?? countOf(structured.images))}
              />
              <DetailRow
                label="Videos"
                value={String(soup?.videos.length ?? countOf(structured.videos))}
              />
              <DetailRow
                label="Audio"
                value={String(soup?.audio.length ?? countOf(structured.audio))}
              />
              <DetailRow
                label="Links"
                value={String(soup?.links.length ?? countOf(structured.links))}
              />
              <DetailRow
                label="Original"
                value={
                  originalState === 'ready'
                    ? 'Saved in your files'
                    : originalState === 'loading'
                      ? 'Loading…'
                      : originalState === 'failed'
                        ? (originalNote ?? 'Could not be read.')
                        : 'Not kept — your organization keeps the text only.'
                }
              />
            </TabsContent>
            <TabsContent value="data">
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-secondary/40 p-3 text-[11px]">
                {JSON.stringify(soup ?? capture.structured, null, 2)}
              </pre>
            </TabsContent>
          </Tabs>
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
