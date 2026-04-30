import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveTab } from '@/hooks/use-active-tab';
import { usePageRecognition } from '@/hooks/use-page-recognition';
import { useScrape } from '@/hooks/use-scrape';
import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  Download,
  ImageIcon,
  Link as LinkIcon,
  Loader2,
  PlayCircle,
  Save,
  VideoIcon,
} from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ScrapeView() {
  const { current, loading, error, captureActiveTab, save } = useScrape();
  const recognition = usePageRecognition();
  const tab = useActiveTab();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{tab.title ?? '—'}</div>
          <div className="truncate text-xs text-muted-foreground">{tab.url ?? ''}</div>
        </div>
        {recognition.capturedAt && !saved && (
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5 shrink-0" />
            Captured {new Date(recognition.capturedAt).toLocaleString()}
          </div>
        )}
        {error && (
          <div className="mt-2 rounded-xl bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
            {error}
          </div>
        )}
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
              <ScrapeTab value="schema">Schema</ScrapeTab>
            </TabsList>

            <TabsContent value="article" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <div className="space-y-2 px-3 pb-3">
                  <div className="text-xs text-muted-foreground">
                    {current.article.extractor} · {current.article.word_count ?? '—'} words ·{' '}
                    {current.article.reading_time_minutes ?? '—'} min read
                  </div>
                  <div className="prose prose-sm max-w-none text-sm dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {current.article.content_markdown ?? '_No clean article extracted._'}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="images" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <div className="grid grid-cols-3 gap-1.5 px-3 pb-3">
                  {current.images.map((img) => (
                    <a
                      key={img.src}
                      href={img.src}
                      target="_blank"
                      rel="noreferrer"
                      className="group relative aspect-square overflow-hidden rounded-xl bg-secondary/40"
                    >
                      <img
                        src={img.src}
                        alt={img.alt ?? ''}
                        className="size-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="videos" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <div className="space-y-1 px-3 pb-3">
                  {current.videos.map((v) => (
                    <a
                      key={v.src}
                      href={v.src}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-xl bg-secondary/40 px-3 py-2 text-sm transition-colors hover:bg-secondary/70"
                    >
                      <VideoIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{v.src}</span>
                    </a>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="links" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <div className="space-y-0.5 px-3 pb-3">
                  {current.links.map((l) => (
                    <a
                      key={`${l.href}|${l.text}`}
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      <LinkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate">{l.text || l.href}</div>
                        <div className="truncate text-xs text-muted-foreground">{l.href}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="schema" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <pre className="px-3 pb-3 text-xs whitespace-pre overflow-x-auto">
                  {JSON.stringify({ metadata: current.metadata, ld_json: current.ld_json }, null, 2)}
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

      <div className="flex shrink-0 gap-2 px-3 pb-3 pt-1">
        <Button
          onClick={() => void captureActiveTab()}
          disabled={loading}
          className="flex-1 rounded-full"
        >
          {loading ? (
            <>
              <Loader2 className="animate-spin" /> Capturing…
            </>
          ) : (
            <>
              <PlayCircle /> {current ? 'Re-capture' : 'Capture this page'}
            </>
          )}
        </Button>
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
