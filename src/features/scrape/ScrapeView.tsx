import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveTab } from '@/hooks/use-active-tab';
import { usePageRecognition } from '@/hooks/use-page-recognition';
import { useScrape } from '@/hooks/use-scrape';
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
      <div className="border-b p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{tab.title ?? '—'}</div>
            <div className="truncate text-xs text-muted-foreground">{tab.url ?? ''}</div>
          </div>
        </div>
        {recognition.capturedAt && !saved && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5" />
            Captured {new Date(recognition.capturedAt).toLocaleString()}. Capture again to refresh.
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={() => void captureActiveTab()} disabled={loading} className="flex-1">
            {loading ? (
              <>
                <Loader2 className="animate-spin" /> Capturing…
              </>
            ) : (
              <>
                <PlayCircle /> Capture this page
              </>
            )}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!current || saving}
            variant="secondary"
          >
            {saving ? (
              <>
                <Loader2 className="animate-spin" /> Saving
              </>
            ) : saved ? (
              <>
                <CheckCircle2 /> Saved
              </>
            ) : (
              <>
                <Save /> Save
              </>
            )}
          </Button>
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      {current ? (
        <Tabs defaultValue="article" className="flex-1 flex flex-col min-h-0">
          <TabsList className="m-3 mb-0 self-start">
            <TabsTrigger value="article">Article</TabsTrigger>
            <TabsTrigger value="images">
              Images{' '}
              {current.images.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {current.images.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="videos">
              Video{' '}
              {current.videos.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {current.videos.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="links">
              Links{' '}
              {current.links.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {current.links.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="schema">Schema</TabsTrigger>
          </TabsList>
          <TabsContent value="article" className="flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-2">
                <div className="text-xs text-muted-foreground">
                  Extractor: {current.article.extractor} · {current.article.word_count ?? '—'} words
                  · {current.article.reading_time_minutes ?? '—'} min read
                </div>
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {current.article.content_markdown ?? '_No clean article extracted._'}
                  </ReactMarkdown>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="images" className="flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="grid grid-cols-3 gap-2 p-3">
                {current.images.map((img) => (
                  <a
                    key={img.src}
                    href={img.src}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                  >
                    <img
                      src={img.src}
                      alt={img.alt ?? ''}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="videos" className="flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="space-y-2 p-3">
                {current.videos.map((v) => (
                  <a
                    key={v.src}
                    href={v.src}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-md border bg-card p-2 text-sm hover:bg-accent"
                  >
                    <VideoIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{v.src}</span>
                  </a>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="links" className="flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="divide-y p-3">
                {current.links.map((l) => (
                  <a
                    key={`${l.href}|${l.text}`}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2 py-2 text-sm hover:bg-accent rounded-md"
                  >
                    <LinkIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate">{l.text || l.href}</div>
                      <div className="truncate text-xs text-muted-foreground">{l.href}</div>
                    </div>
                  </a>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="schema" className="flex-1 min-h-0">
            <ScrollArea className="h-full">
              <pre className="p-3 text-xs overflow-x-auto whitespace-pre">
                {JSON.stringify({ metadata: current.metadata, ld_json: current.ld_json }, null, 2)}
              </pre>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <ImageIcon className="size-4" />
              <Download className="size-4" />
              <LinkIcon className="size-4" />
            </div>
            Click capture to scrape the active tab.
          </div>
        </div>
      )}
    </div>
  );
}
