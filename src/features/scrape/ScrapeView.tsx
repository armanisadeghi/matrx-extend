import { AddToProjectButton } from '@/components/AddToProjectButton';
import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DiagnoseCard, DiagnoseLauncher } from '@/features/scrape/DiagnoseCard';
import { MarkdownView } from '@/components/MarkdownView';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveTab } from '@/hooks/use-active-tab';
import { usePageRecognition } from '@/hooks/use-page-recognition';
import { usePageScrollSync } from '@/hooks/use-page-scroll-sync';
import { useScrape } from '@/hooks/use-scrape';
import type { CaptureError, CaptureErrorAction } from '@/lib/scrape/capture-error';
import { partitionImages } from '@/lib/scrape/classify-images';
import {
  articleCopyOptions,
  fullCaptureCopyOptions,
  imagesCopyOptions,
  linksCopyOptions,
  schemaCopyOptions,
  seoCopyOptions,
  videosCopyOptions,
} from '@/lib/scrape/copy-options';
import { articleToMarkdown } from '@/lib/scrape/to-markdown';
import type { SeoAudit } from '@/lib/seo/audit';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/state/auth';
import { useHighlightStore } from '@/state/highlights';
import { scrapeLinkKey, useScrapeStore } from '@/state/scrape';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronsDown,
  Download,
  ImageIcon,
  Link as LinkIcon,
  Loader2,
  Link2,
  Link2Off,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  VideoIcon,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export function ScrapeView() {
  const {
    current,
    loading,
    activeMode,
    progress,
    error,
    edited,
    captureActiveTab,
    reloadActiveTab,
    clearError,
    save,
    launchDiagnose,
  } = useScrape();
  const setCurrent = useScrapeStore((s) => s.setCurrent);
  const editArticleMarkdown = useScrapeStore((s) => s.editArticleMarkdown);
  const removeImage = useScrapeStore((s) => s.removeImage);
  const addImage = useScrapeStore((s) => s.addImage);
  const removeVideo = useScrapeStore((s) => s.removeVideo);
  const addVideo = useScrapeStore((s) => s.addVideo);
  const removeLink = useScrapeStore((s) => s.removeLink);
  const addLink = useScrapeStore((s) => s.addLink);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const recognition = usePageRecognition();
  const tab = useActiveTab();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /**
   * Side-by-side scroll sync. Off by default — opt-in. Some pages can't
   * stream scroll events (chrome:// etc.), but the hook degrades silently.
   */
  const [scrollSync, setScrollSync] = useState(false);
  const articleScrollRef = useRef<HTMLDivElement | null>(null);
  usePageScrollSync(scrollSync, articleScrollRef);
  /** Article-tab edit state. Local draft so Cancel can discard cleanly. */
  const [editingArticle, setEditingArticle] = useState(false);
  const [articleDraft, setArticleDraft] = useState('');
  /** Pending re-capture mode while waiting on the unsaved-edits confirm. */
  const [pendingCaptureMode, setPendingCaptureMode] = useState<'fast' | 'deep' | null>(null);

  const beginArticleEdit = () => {
    setArticleDraft(current?.article.content_markdown ?? '');
    setEditingArticle(true);
  };
  const cancelArticleEdit = () => setEditingArticle(false);
  const commitArticleEdit = () => {
    editArticleMarkdown(articleDraft);
    setEditingArticle(false);
  };

  /** Re-capture confirm guard — protects unsaved local edits. */
  /**
   * Three-tier image partition. All tiers stay visible; sizing/ordering does
   * the visual heavy lifting so the panel reads well on icon-heavy pages
   * without hiding anything the user might actually want to see.
   */
  const partitionedImages = useMemo(
    () => partitionImages(current?.images ?? []),
    [current?.images],
  );

  const guardedCapture = (mode: 'fast' | 'deep') => {
    if (edited) {
      // Defer until the user confirms via the modal below — `pendingCaptureMode`
      // captures the requested mode so the confirm handler can replay it.
      setPendingCaptureMode(mode);
      return;
    }
    setEditingArticle(false);
    void captureActiveTab({ mode });
  };

  const confirmRecapture = () => {
    const mode = pendingCaptureMode;
    setPendingCaptureMode(null);
    if (!mode) return;
    setEditingArticle(false);
    void captureActiveTab({ mode });
  };

  // Clear stale capture state when the user navigates to a new URL.
  // Without this, the panel keeps showing the previous page's article and
  // the button reads "Re-capture" — both wrong, both confusing.
  useEffect(() => {
    if (current && tab.url && current.url !== tab.url) {
      setCurrent(null);
      setSaved(false);
    }
  }, [tab.url, current, setCurrent]);

  // Local edits invalidate the "Saved" badge — the persisted row no longer
  // matches the in-memory state until the user hits Save again.
  useEffect(() => {
    if (edited && saved) setSaved(false);
  }, [edited, saved]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const r = await save();
    setSaving(false);
    if (r) setSaved(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 pt-2 pb-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{tab.title ?? '—'}</div>
            <div className="truncate text-xs text-muted-foreground">{tab.url ?? ''}</div>
          </div>
          <AddToProjectButton url={tab.url} title={tab.title} variant="icon" />
          {current && <CopyMenu title="Copy capture" options={fullCaptureCopyOptions(current)} />}
        </div>
        <HighlightRegionsBanner />
        {recognition.capturedAt && !saved && (
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5 shrink-0" />
            Captured {new Date(recognition.capturedAt).toLocaleString()}
          </div>
        )}
        {error && (
          <CaptureErrorCard
            error={error}
            isAdmin={isAdmin}
            onReloadTab={() => void reloadActiveTab()}
            onTryAgain={() => void captureActiveTab({ mode: activeMode ?? 'fast' })}
            onDismiss={clearError}
          />
        )}
        {current && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Diagnose
            </span>
            <DiagnoseLauncher onLaunch={() => void launchDiagnose()} />
          </div>
        )}
        <DiagnoseCard />
      </div>

      <div className="flex flex-1 flex-col min-h-0">
        {current ? (
          <Tabs defaultValue="article" className="flex flex-1 flex-col min-h-0">
            <TabsList className="mx-3 mt-1 self-start gap-1 bg-transparent p-0">
              <ScrapeTab value="article">Article</ScrapeTab>
              <ScrapeTab value="images" count={current.images.length}>
                Images
              </ScrapeTab>
              <ScrapeTab value="videos" count={current.videos.length}>
                Video
              </ScrapeTab>
              <ScrapeTab value="links" count={current.links.length}>
                Links
              </ScrapeTab>
              <ScrapeTab value="seo">SEO</ScrapeTab>
              <ScrapeTab value="schema">Schema</ScrapeTab>
            </TabsList>

            <TabsContent value="article" className="flex-1 min-h-0">
              <div ref={articleScrollRef} className="h-full overflow-y-auto">
                <div className="space-y-2 px-3 pb-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex-1 truncate">
                      {current.article.extractor} · {current.article.word_count ?? '—'} words ·{' '}
                      {current.article.reading_time_minutes ?? '—'} min read
                    </span>
                    {edited && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        edited
                      </span>
                    )}
                    {!editingArticle && (
                      <button
                        type="button"
                        onClick={beginArticleEdit}
                        title="Edit article markdown"
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setScrollSync((v) => !v)}
                      title={
                        scrollSync
                          ? 'Stop following the page scroll'
                          : 'Sync scroll with the live page'
                      }
                      className={cn(
                        'inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors',
                        scrollSync
                          ? 'bg-primary/15 text-primary hover:bg-primary/20'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {scrollSync ? (
                        <Link2 className="size-3.5" />
                      ) : (
                        <Link2Off className="size-3.5" />
                      )}
                    </button>
                    <CopyMenu title="Copy article" options={articleCopyOptions(current)} />
                  </div>
                  {editingArticle ? (
                    <div className="space-y-2">
                      <textarea
                        value={articleDraft}
                        onChange={(e) => setArticleDraft(e.target.value)}
                        spellCheck={false}
                        className="min-h-[60vh] w-full resize-y rounded-xl border bg-background p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Article markdown — edit freely. Save persists to the in-memory capture; click Save below to write it to the server."
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={commitArticleEdit}
                          className="rounded-full"
                        >
                          <CheckCircle2 /> Apply
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={cancelArticleEdit}
                          className="rounded-full"
                        >
                          Cancel
                        </Button>
                        <span className="text-[11px] text-muted-foreground">
                          Apply updates the in-memory capture. Use Save below to persist.
                        </span>
                      </div>
                    </div>
                  ) : (
                    <MarkdownView content={articleToMarkdown(current)} />
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="images" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                {current.images.length > 0 && (
                  <ListToolbar
                    label={imagesToolbarLabel(partitionedImages)}
                    copyMenu={<CopyMenu title="Copy images" options={imagesCopyOptions(current)} />}
                  />
                )}
                {partitionedImages.large.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5 px-3 pb-3">
                    {partitionedImages.large.map((img) => (
                      <ImageTile
                        key={img.src}
                        img={img}
                        size="large"
                        onRemove={() => removeImage(img.src)}
                      />
                    ))}
                  </div>
                )}
                {partitionedImages.medium.length > 0 && (
                  <ImageSubsection
                    label={`${partitionedImages.medium.length} smaller image${partitionedImages.medium.length === 1 ? '' : 's'}`}
                  >
                    <div className="grid grid-cols-5 gap-1 px-3 pb-3">
                      {partitionedImages.medium.map((img) => (
                        <ImageTile
                          key={img.src}
                          img={img}
                          size="medium"
                          onRemove={() => removeImage(img.src)}
                        />
                      ))}
                    </div>
                  </ImageSubsection>
                )}
                {partitionedImages.icons.length > 0 && (
                  <ImageSubsection
                    label={`${partitionedImages.icons.length} icon${partitionedImages.icons.length === 1 ? '' : 's'} & favicon${partitionedImages.icons.length === 1 ? '' : 's'}`}
                  >
                    <div className="grid grid-cols-8 gap-0.5 px-3 pb-3">
                      {partitionedImages.icons.map((img) => (
                        <ImageTile
                          key={img.src}
                          img={img}
                          size="icon"
                          onRemove={() => removeImage(img.src)}
                        />
                      ))}
                    </div>
                  </ImageSubsection>
                )}
                <AddItemRow
                  label="Add image URL"
                  fields={[
                    { name: 'src', placeholder: 'https://…' },
                    { name: 'alt', placeholder: 'alt text (optional)' },
                  ]}
                  onAdd={(values) => {
                    if (!values.src) return false;
                    addImage({ src: values.src, alt: values.alt || null });
                    return true;
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="videos" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                {current.videos.length > 0 && (
                  <ListToolbar
                    label={`${current.videos.length} video${current.videos.length === 1 ? '' : 's'}`}
                    copyMenu={<CopyMenu title="Copy videos" options={videosCopyOptions(current)} />}
                  />
                )}
                <div className="space-y-1 px-3 pb-3">
                  {current.videos.map((v) => (
                    <div
                      key={v.src}
                      className="group flex items-center gap-2 rounded-xl bg-secondary/40 px-3 py-2 text-sm transition-colors hover:bg-secondary/70"
                    >
                      <VideoIcon className="size-4 shrink-0 text-muted-foreground" />
                      <a
                        href={v.src}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate"
                      >
                        {v.src}
                      </a>
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <CopyButton text={v.src} title="Copy video URL" size="xs" />
                        <DeleteRowButton
                          title="Remove video"
                          onClick={() => removeVideo(v.src)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <AddItemRow
                  label="Add video URL"
                  fields={[{ name: 'src', placeholder: 'https://…' }]}
                  onAdd={(values) => {
                    if (!values.src) return false;
                    addVideo({ src: values.src });
                    return true;
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="links" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                {current.links.length > 0 && (
                  <ListToolbar
                    label={`${current.links.length} link${current.links.length === 1 ? '' : 's'}`}
                    copyMenu={<CopyMenu title="Copy links" options={linksCopyOptions(current)} />}
                  />
                )}
                <div className="space-y-0.5 px-3 pb-3">
                  {current.links.map((l) => (
                    <div
                      key={scrapeLinkKey(l.href, l.text)}
                      className="group flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      <LinkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1"
                      >
                        <div className="truncate">{l.text || l.href}</div>
                        <div className="truncate text-xs text-muted-foreground">{l.href}</div>
                      </a>
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <CopyButton text={l.href} title="Copy URL" size="xs" />
                        <DeleteRowButton
                          title="Remove link"
                          onClick={() => removeLink(scrapeLinkKey(l.href, l.text))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <AddItemRow
                  label="Add link"
                  fields={[
                    { name: 'href', placeholder: 'https://…' },
                    { name: 'text', placeholder: 'anchor text (optional)' },
                  ]}
                  onAdd={(values) => {
                    if (!values.href) return false;
                    addLink({ href: values.href, text: values.text });
                    return true;
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="seo" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <ListToolbar
                  label="SEO audit"
                  copyMenu={<CopyMenu title="Copy SEO audit" options={seoCopyOptions(current)} />}
                />
                <SeoPanel seo={current.seo} />
              </div>
            </TabsContent>

            <TabsContent value="schema" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <ListToolbar
                  label="Schema & metadata"
                  copyMenu={<CopyMenu title="Copy schema" options={schemaCopyOptions(current)} />}
                />
                <pre className="px-3 pb-3 text-xs whitespace-pre overflow-x-auto">
                  {JSON.stringify(
                    { metadata: current.metadata, ld_json: current.ld_json },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-muted-foreground/60">
                <ImageIcon className="size-4" />
                <Download className="size-4" />
                <LinkIcon className="size-4" />
              </div>
              Capture this page to extract content.
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3 pt-1">
        <div className="flex gap-2">
          <Button
            onClick={() => guardedCapture('fast')}
            disabled={loading}
            className="flex-1 rounded-full"
            title="Capture the page exactly as it is right now"
          >
            {loading && activeMode === 'fast' ? (
              <>
                <Loader2 className="animate-spin" /> Capturing…
              </>
            ) : (
              <>
                <PlayCircle /> {current ? 'Re-capture' : 'Capture'}
              </>
            )}
          </Button>
          <Button
            onClick={() => guardedCapture('deep')}
            disabled={loading}
            variant="secondary"
            className="flex-1 rounded-full"
            title="Scroll the page top→bottom to load lazy content (images, infinite-scroll items), then capture. Better for dynamic pages."
          >
            {loading && activeMode === 'deep' ? (
              <>
                <Loader2 className="animate-spin" />
                {progress ? `Scrolling ${progress.step}/${progress.total}…` : 'Scrolling…'}
              </>
            ) : (
              <>
                <ChevronsDown /> Scroll & capture
              </>
            )}
          </Button>
        </div>
        {current && (
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            variant="secondary"
            className="rounded-full"
          >
            {saving ? <Loader2 className="animate-spin" /> : saved ? <CheckCircle2 /> : <Save />}
            {saved ? 'Saved' : 'Save'}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={pendingCaptureMode !== null}
        title="Discard unsaved edits?"
        description="You have unsaved edits to this capture. Re-capturing will discard them. Continue?"
        confirmLabel="Re-capture"
        destructive
        onConfirm={confirmRecapture}
        onClose={() => setPendingCaptureMode(null)}
      />
    </div>
  );
}

function imagesToolbarLabel({
  large,
  medium,
  icons,
}: {
  large: { length: number };
  medium: { length: number };
  icons: { length: number };
}): string {
  const parts: string[] = [];
  parts.push(`${large.length} image${large.length === 1 ? '' : 's'}`);
  if (medium.length > 0) parts.push(`${medium.length} small`);
  if (icons.length > 0) parts.push(`${icons.length} icon${icons.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function ImageSubsection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function ImageTile({
  img,
  size,
  onRemove,
}: {
  img: { src: string; alt: string | null };
  size: 'large' | 'medium' | 'icon';
  onRemove: () => void;
}) {
  // `object-cover` for content thumbs (fills the square nicely), `object-contain`
  // for smaller graphics so logos/icons aren't cropped at the edges. The
  // checkerboard background keeps transparent assets legible in light + dark.
  const tileClass =
    size === 'large'
      ? 'aspect-square overflow-hidden rounded-xl checkerboard-bg'
      : size === 'medium'
        ? 'aspect-square overflow-hidden rounded-lg checkerboard-bg'
        : 'aspect-square overflow-hidden rounded-md checkerboard-bg';
  const imgClass =
    size === 'large'
      ? 'size-full object-cover transition-transform group-hover:scale-105'
      : size === 'medium'
        ? 'size-full object-contain p-1'
        : 'size-full object-contain p-0.5';
  return (
    <div className={cn('group relative', tileClass)} title={img.alt ?? img.src}>
      <a href={img.src} target="_blank" rel="noreferrer" className="block size-full">
        <img src={img.src} alt={img.alt ?? ''} className={imgClass} loading="lazy" />
      </a>
      <div
        className={cn(
          'absolute flex gap-1 opacity-0 transition-opacity group-hover:opacity-100',
          size === 'icon' ? 'right-0 top-0' : 'right-1 top-1',
        )}
      >
        {size !== 'icon' && (
          <CopyButton
            text={img.src}
            title="Copy image URL"
            size="xs"
            className="bg-background/80 backdrop-blur"
          />
        )}
        <DeleteRowButton
          title="Remove image"
          onClick={onRemove}
          className="bg-background/80 backdrop-blur"
        />
      </div>
    </div>
  );
}

function ListToolbar({
  label,
  copyMenu,
}: {
  label: string;
  copyMenu: React.ReactNode;
}) {
  return (
    <div className="flex h-7 items-center justify-between px-3">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {copyMenu}
    </div>
  );
}

function DeleteRowButton({
  title,
  onClick,
  className,
}: {
  title: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      title={title}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive',
        className,
      )}
    >
      <X className="size-3" />
    </button>
  );
}

interface AddItemField {
  name: string;
  placeholder: string;
}

function AddItemRow({
  label,
  fields,
  onAdd,
}: {
  label: string;
  fields: AddItemField[];
  /** Return true to clear the inputs after add; false to keep them (e.g. validation failed). */
  onAdd: (values: Record<string, string>) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  if (!open) {
    return (
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
        >
          <Plus className="size-3.5" /> {label}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-3 pb-3">
      <div className="space-y-1.5 rounded-xl border bg-card p-2">
        {fields.map((f) => (
          <input
            key={f.name}
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            placeholder={f.placeholder}
            className="w-full rounded-md bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        ))}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              if (onAdd(values)) setValues({});
            }}
            className="h-7 rounded-full text-xs"
          >
            <Plus className="size-3.5" /> Add
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setValues({});
              setOpen(false);
            }}
            className="h-7 rounded-full text-xs"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<CaptureErrorAction, { label: string; Icon: typeof RefreshCw }> = {
  'reload-tab': { label: 'Reload page', Icon: RefreshCw },
  'try-again': { label: 'Try again', Icon: RotateCcw },
};

function CaptureErrorCard({
  error,
  isAdmin,
  onReloadTab,
  onTryAgain,
  onDismiss,
}: {
  error: CaptureError;
  isAdmin: boolean;
  onReloadTab: () => void;
  onTryAgain: () => void;
  onDismiss: () => void;
}) {
  const Icon = error.recoverable ? AlertTriangle : Ban;
  const tone = error.recoverable
    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30'
    : 'bg-destructive/10 text-destructive border-destructive/30';

  const handleClick = (action: CaptureErrorAction) => {
    if (action === 'reload-tab') {
      onReloadTab();
      return;
    }
    if (action === 'try-again') {
      onTryAgain();
      return;
    }
  };

  return (
    <div className={cn('mt-2 rounded-xl border p-3', tone)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium">{error.title}</div>
          <div className="text-xs leading-relaxed opacity-90">{error.description}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs opacity-60 hover:opacity-100"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      {error.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {error.actions.map((action) => {
            const cfg = ACTION_LABELS[action];
            const isPrimary = action === error.actions[0];
            return (
              <Button
                key={action}
                size="sm"
                variant={isPrimary ? 'default' : 'secondary'}
                className="h-7 rounded-full text-xs"
                onClick={() => handleClick(action)}
              >
                <cfg.Icon className="size-3.5" /> {cfg.label}
              </Button>
            );
          })}
        </div>
      )}
      {isAdmin && (
        <details className="mt-3 text-[10px]">
          <summary className="cursor-pointer select-none font-mono uppercase tracking-wider opacity-70 hover:opacity-100">
            Diagnostics (admin)
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-background/60 p-2 font-mono text-[10px] leading-snug text-foreground/80">
            {JSON.stringify(error, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function ScrapeTab({
  value,
  count,
  children,
}: {
  value: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'h-6 rounded-md bg-transparent px-2.5 py-0 text-xs text-muted-foreground shadow-none',
        'data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:shadow-none',
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className="ml-1.5 text-[10px] tabular-nums opacity-70">{count}</span>
      )}
    </TabsTrigger>
  );
}

function SeoPanel({ seo }: { seo: SeoAudit }) {
  return (
    <div className="space-y-4 px-3 pb-3">
      <SeoSection label="Title & description">
        <SeoRow label="Title" value={seo.title.value || '—'} hint={`${seo.title.length} chars`} />
        <SeoRow
          label="Description"
          value={seo.description.value ?? '—'}
          hint={`${seo.description.length} chars`}
        />
        <SeoRow label="Canonical" value={seo.canonical ?? '—'} mono />
        <SeoRow label="Robots" value={seo.robots ?? '—'} />
      </SeoSection>

      {seo.hreflang.length > 0 && (
        <SeoSection label="Hreflang" hint={String(seo.hreflang.length)}>
          <div className="space-y-1 text-xs">
            {seo.hreflang.map((h, i) => (
              <div key={`${h.lang}-${i}`} className="flex gap-2">
                <span className="w-12 shrink-0 text-muted-foreground">{h.lang}</span>
                <span className="truncate font-mono">{h.href}</span>
              </div>
            ))}
          </div>
        </SeoSection>
      )}

      <SeoSection label="Open Graph & Twitter">
        {Object.keys(seo.og).length === 0 && Object.keys(seo.twitter).length === 0 ? (
          <div className="text-xs text-muted-foreground">No social meta tags.</div>
        ) : (
          <div className="space-y-1 text-xs">
            {Object.entries(seo.og).map(([k, v]) => (
              <SeoMetaRow key={k} k={k} v={v} />
            ))}
            {Object.entries(seo.twitter).map(([k, v]) => (
              <SeoMetaRow key={k} k={k} v={v} />
            ))}
          </div>
        )}
      </SeoSection>

      {seo.schema_types.length > 0 && (
        <SeoSection label="Schema types" hint={String(seo.schema_types.length)}>
          <div className="flex flex-wrap gap-1">
            {seo.schema_types.map((t) => (
              <span
                key={t}
                className="rounded-full bg-secondary/40 px-2 py-0.5 text-[10px] font-mono"
              >
                {t}
              </span>
            ))}
          </div>
        </SeoSection>
      )}

      <SeoSection label="Headings" hint={String(seo.headings.length)}>
        <div className="space-y-1 text-xs">
          {seo.headings.slice(0, 50).map((h, i) => (
            <div key={`${h.level}-${i}`} className="truncate">
              <span className="mr-1.5 text-muted-foreground">H{h.level}</span>
              {h.text}
            </div>
          ))}
          {seo.headings.length > 50 && (
            <div className="text-[10px] text-muted-foreground">
              + {seo.headings.length - 50} more
            </div>
          )}
        </div>
      </SeoSection>

      <SeoSection label="Page stats">
        <div className="grid grid-cols-3 gap-2">
          <SeoStat label="Images" value={seo.images.total} />
          <SeoStat
            label="Missing alt"
            value={seo.images.missing_alt}
            tone={seo.images.missing_alt > 0 ? 'warn' : 'ok'}
          />
          <SeoStat label="Words" value={seo.word_count} />
          <SeoStat label="Internal links" value={seo.links.internal} />
          <SeoStat label="External links" value={seo.links.external} />
          <SeoStat label="Flesch" value={seo.flesch_reading_ease ?? '—'} hint="reading ease" />
        </div>
      </SeoSection>

      {seo.performance.duration_ms !== null && (
        <SeoSection label="Performance">
          <SeoRow
            label="Load duration"
            value={seo.performance.duration_ms !== null ? `${seo.performance.duration_ms} ms` : '—'}
          />
          {seo.performance.transfer_size_bytes !== null && (
            <SeoRow
              label="Transfer size"
              value={`${Math.round(seo.performance.transfer_size_bytes / 1024)} KB`}
            />
          )}
        </SeoSection>
      )}
    </div>
  );
}

function SeoSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {hint && <span className="text-[10px] tabular-nums text-muted-foreground/70">{hint}</span>}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="divide-y divide-border/60 px-3 py-2 text-sm">{children}</div>
      </div>
    </div>
  );
}

function SeoRow({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-baseline gap-2">
        {hint && <span className="shrink-0 text-[10px] text-muted-foreground/70">{hint}</span>}
        <span className={cn('truncate text-right', mono && 'font-mono text-xs')}>{value}</span>
      </div>
    </div>
  );
}

function SeoMetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 truncate font-mono text-muted-foreground">{k}</span>
      <span className="truncate">{v}</span>
    </div>
  );
}

function SeoStat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'ok'
        ? 'text-emerald-600 dark:text-emerald-400'
        : '';
  return (
    <div className="rounded-lg bg-secondary/40 px-2.5 py-1.5">
      <div className={cn('text-base font-semibold tabular-nums', toneClass)}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      {hint && <div className="text-[9px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

/**
 * Banner shown when the Highlight tab hands off highlighted regions to Scrape.
 * Surfaces the combined text with a copy-for-agent affordance. Consumed +
 * cleared on mount so revisits don't re-show stale handoffs.
 */
function HighlightRegionsBanner() {
  const regions = useHighlightStore((s) => s.scrapeHandoff);
  const setScrapeHandoff = useHighlightStore((s) => s.setScrapeHandoff);
  const [items, setItems] = useState<{ title: string; text: string }[] | null>(null);

  useEffect(() => {
    if (regions && regions.length > 0) {
      setItems(regions);
      setScrapeHandoff(null);
    }
  }, [regions, setScrapeHandoff]);

  if (!items || items.length === 0) return null;
  const combined = items.map((r) => r.text).join('\n\n');

  return (
    <div className="mt-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-amber-700 dark:text-amber-300">
          {items.length} highlighted region{items.length === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-1">
          <CopyButton text={combined} title="Copy regions" />
          <button
            onClick={() => setItems(null)}
            className="rounded-md p-0.5 text-amber-600/70 hover:bg-amber-400/20 hover:text-amber-700 dark:text-amber-400/70"
            title="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-amber-800/80 dark:text-amber-200/80">
        {combined}
      </pre>
    </div>
  );
}
