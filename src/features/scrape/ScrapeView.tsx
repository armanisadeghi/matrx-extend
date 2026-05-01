import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useActiveTab } from '@/hooks/use-active-tab';
import { usePageRecognition } from '@/hooks/use-page-recognition';
import { useScrape } from '@/hooks/use-scrape';
import { stringifyJson, wrapForAgent, wrapJsonForAgent } from '@/lib/clipboard/copy';
import type { SeoAudit } from '@/lib/seo/audit';
import { cn } from '@/lib/utils';
import { useScrapeStore } from '@/state/scrape';
import {
  CheckCircle2,
  ChevronsDown,
  Download,
  ImageIcon,
  Link as LinkIcon,
  Loader2,
  PlayCircle,
  Save,
  VideoIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ScrapeView() {
  const { current, loading, activeMode, progress, error, captureActiveTab, save } = useScrape();
  const setCurrent = useScrapeStore((s) => s.setCurrent);
  const recognition = usePageRecognition();
  const tab = useActiveTab();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Clear stale capture state when the user navigates to a new URL.
  // Without this, the panel keeps showing the previous page's article and
  // the button reads "Re-capture" — both wrong, both confusing.
  useEffect(() => {
    if (current && tab.url && current.url !== tab.url) {
      setCurrent(null);
      setSaved(false);
    }
  }, [tab.url, current, setCurrent]);

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
          {current && (
            <CopyMenu
              title="Copy capture"
              options={[
                {
                  label: 'Article (Markdown)',
                  description: 'Just the cleaned article text',
                  getContent: () => current.article.content_markdown ?? '',
                },
                {
                  label: 'Page URL',
                  getContent: () => current.url ?? tab.url ?? '',
                },
                {
                  label: 'For AI agent',
                  description: 'Article + metadata, wrapped',
                  ai: true,
                  getContent: () =>
                    wrapForAgent({
                      description: 'an article scraped from a webpage',
                      source: {
                        url: current.url ?? tab.url ?? null,
                        title: current.article.title ?? tab.title ?? null,
                        capturedAt: Date.now(),
                      },
                      meta: {
                        wordCount: current.article.word_count ?? null,
                        readingTimeMinutes: current.article.reading_time_minutes ?? null,
                        extractor: current.article.extractor,
                      },
                      format: 'markdown',
                      content: current.article.content_markdown ?? '',
                    }),
                },
                {
                  label: 'Full capture (JSON)',
                  description: 'Article + media + schema',
                  adminOnly: true,
                  getContent: () => stringifyJson(current),
                },
                {
                  label: 'Full capture for AI (JSON)',
                  ai: true,
                  adminOnly: true,
                  getContent: () =>
                    wrapJsonForAgent(current, {
                      description: "the full Matrx scrape result for a webpage",
                      source: {
                        url: current.url ?? tab.url ?? null,
                        title: current.article.title ?? tab.title ?? null,
                      },
                    }),
                },
              ]}
            />
          )}
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
              <ScrapeTab value="seo">SEO</ScrapeTab>
              <ScrapeTab value="schema">Schema</ScrapeTab>
            </TabsList>

            <TabsContent value="article" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <div className="space-y-2 px-3 pb-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="flex-1 truncate">
                      {current.article.extractor} · {current.article.word_count ?? '—'} words ·{' '}
                      {current.article.reading_time_minutes ?? '—'} min read
                    </span>
                    <CopyMenu
                      title="Copy article"
                      options={[
                        {
                          label: 'Markdown',
                          getContent: () => current.article.content_markdown ?? '',
                        },
                        {
                          label: 'Plain text',
                          getContent: () =>
                            stripMarkdown(current.article.content_markdown ?? ''),
                        },
                        {
                          label: 'For AI agent',
                          ai: true,
                          getContent: () =>
                            wrapForAgent({
                              description: 'an article scraped from a webpage',
                              source: {
                                url: current.url ?? tab.url ?? null,
                                title: current.article.title ?? tab.title ?? null,
                              },
                              meta: {
                                wordCount: current.article.word_count ?? null,
                                readingTimeMinutes: current.article.reading_time_minutes ?? null,
                              },
                              format: 'markdown',
                              content: current.article.content_markdown ?? '',
                            }),
                        },
                        {
                          label: 'HTML (cleaned)',
                          adminOnly: true,
                          getContent: () => current.article.content_html_safe ?? '',
                        },
                        {
                          label: 'Article (JSON)',
                          adminOnly: true,
                          getContent: () => stringifyJson(current.article),
                        },
                      ]}
                    />
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
                {current.images.length > 0 && (
                  <ListToolbar
                    label={`${current.images.length} image${current.images.length === 1 ? '' : 's'}`}
                    copyMenu={
                      <CopyMenu
                        title="Copy images"
                        options={[
                          {
                            label: 'URLs (one per line)',
                            getContent: () => current.images.map((i) => i.src).join('\n'),
                          },
                          {
                            label: 'For AI agent',
                            ai: true,
                            getContent: () =>
                              wrapForAgent({
                                description: 'a list of images extracted from a webpage',
                                source: {
                                  url: current.url ?? tab.url ?? null,
                                  title: current.article.title ?? tab.title ?? null,
                                },
                                meta: { count: current.images.length },
                                format: 'text',
                                content: current.images
                                  .map((i) =>
                                    i.alt ? `${i.src}\n  alt: ${i.alt}` : i.src,
                                  )
                                  .join('\n'),
                              }),
                          },
                          {
                            label: 'JSON',
                            adminOnly: true,
                            getContent: () => stringifyJson(current.images),
                          },
                        ]}
                      />
                    }
                  />
                )}
                <div className="grid grid-cols-3 gap-1.5 px-3 pb-3">
                  {current.images.map((img) => (
                    <div
                      key={img.src}
                      className="group relative aspect-square overflow-hidden rounded-xl bg-secondary/40"
                    >
                      <a href={img.src} target="_blank" rel="noreferrer" className="block size-full">
                        <img
                          src={img.src}
                          alt={img.alt ?? ''}
                          className="size-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                      </a>
                      <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <CopyButton
                          text={img.src}
                          title="Copy image URL"
                          size="xs"
                          className="bg-background/80 backdrop-blur"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="videos" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                {current.videos.length > 0 && (
                  <ListToolbar
                    label={`${current.videos.length} video${current.videos.length === 1 ? '' : 's'}`}
                    copyMenu={
                      <CopyMenu
                        title="Copy videos"
                        options={[
                          {
                            label: 'URLs (one per line)',
                            getContent: () => current.videos.map((v) => v.src).join('\n'),
                          },
                          {
                            label: 'For AI agent',
                            ai: true,
                            getContent: () =>
                              wrapForAgent({
                                description: 'a list of video sources extracted from a webpage',
                                source: {
                                  url: current.url ?? tab.url ?? null,
                                  title: current.article.title ?? tab.title ?? null,
                                },
                                meta: { count: current.videos.length },
                                format: 'text',
                                content: current.videos.map((v) => v.src).join('\n'),
                              }),
                          },
                          {
                            label: 'JSON',
                            adminOnly: true,
                            getContent: () => stringifyJson(current.videos),
                          },
                        ]}
                      />
                    }
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
                      <CopyButton
                        text={v.src}
                        title="Copy video URL"
                        size="xs"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="links" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                {current.links.length > 0 && (
                  <ListToolbar
                    label={`${current.links.length} link${current.links.length === 1 ? '' : 's'}`}
                    copyMenu={
                      <CopyMenu
                        title="Copy links"
                        options={[
                          {
                            label: 'URLs (one per line)',
                            getContent: () => current.links.map((l) => l.href).join('\n'),
                          },
                          {
                            label: 'As Markdown list',
                            getContent: () =>
                              current.links
                                .map((l) => `- [${l.text || l.href}](${l.href})`)
                                .join('\n'),
                          },
                          {
                            label: 'For AI agent',
                            ai: true,
                            getContent: () =>
                              wrapForAgent({
                                description: 'a list of links extracted from a webpage',
                                source: {
                                  url: current.url ?? tab.url ?? null,
                                  title: current.article.title ?? tab.title ?? null,
                                },
                                meta: { count: current.links.length },
                                format: 'markdown',
                                content: current.links
                                  .map((l) => `- [${l.text || l.href}](${l.href})`)
                                  .join('\n'),
                              }),
                          },
                          {
                            label: 'JSON',
                            adminOnly: true,
                            getContent: () => stringifyJson(current.links),
                          },
                        ]}
                      />
                    }
                  />
                )}
                <div className="space-y-0.5 px-3 pb-3">
                  {current.links.map((l) => (
                    <div
                      key={`${l.href}|${l.text}`}
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
                      <CopyButton
                        text={l.href}
                        title="Copy URL"
                        size="xs"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="seo" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <ListToolbar
                  label="SEO audit"
                  copyMenu={
                    <CopyMenu
                      title="Copy SEO audit"
                      options={[
                        {
                          label: 'Summary (text)',
                          getContent: () =>
                            seoToText(current.seo, current.url ?? tab.url ?? null),
                        },
                        {
                          label: 'For AI agent',
                          ai: true,
                          getContent: () =>
                            wrapForAgent({
                              description: 'an SEO audit for a webpage',
                              source: {
                                url: current.url ?? tab.url ?? null,
                                title: current.article.title ?? tab.title ?? null,
                              },
                              format: 'text',
                              content: seoToText(current.seo, current.url ?? tab.url ?? null),
                            }),
                        },
                        {
                          label: 'JSON',
                          adminOnly: true,
                          getContent: () => stringifyJson(current.seo),
                        },
                      ]}
                    />
                  }
                />
                <SeoPanel seo={current.seo} />
              </div>
            </TabsContent>

            <TabsContent value="schema" className="flex-1 min-h-0">
              <div className="h-full overflow-y-auto">
                <ListToolbar
                  label="Schema & metadata"
                  copyMenu={
                    <CopyMenu
                      title="Copy schema"
                      options={[
                        {
                          label: 'JSON',
                          getContent: () =>
                            stringifyJson({
                              metadata: current.metadata,
                              ld_json: current.ld_json,
                            }),
                        },
                        {
                          label: 'For AI agent',
                          ai: true,
                          getContent: () =>
                            wrapJsonForAgent(
                              { metadata: current.metadata, ld_json: current.ld_json },
                              {
                                description:
                                  'metadata + JSON-LD schema extracted from a webpage',
                                source: {
                                  url: current.url ?? tab.url ?? null,
                                  title: current.article.title ?? tab.title ?? null,
                                },
                              },
                            ),
                        },
                      ]}
                    />
                  }
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
            onClick={() => void captureActiveTab({ mode: 'fast' })}
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
            onClick={() => void captureActiveTab({ mode: 'deep' })}
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

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?|\n?```$/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function seoToText(seo: SeoAudit, url: string | null): string {
  const lines: string[] = [];
  if (url) lines.push(`URL: ${url}`);
  lines.push(`Title (${seo.title.length} chars): ${seo.title.value || '—'}`);
  lines.push(
    `Description (${seo.description.length} chars): ${seo.description.value ?? '—'}`,
  );
  lines.push(`Canonical: ${seo.canonical ?? '—'}`);
  lines.push(`Robots: ${seo.robots ?? '—'}`);
  if (seo.hreflang.length > 0) {
    lines.push('');
    lines.push(`Hreflang (${seo.hreflang.length}):`);
    for (const h of seo.hreflang) lines.push(`  ${h.lang}: ${h.href}`);
  }
  if (seo.schema_types.length > 0) {
    lines.push('');
    lines.push(`Schema types: ${seo.schema_types.join(', ')}`);
  }
  if (seo.headings.length > 0) {
    lines.push('');
    lines.push(`Headings (${seo.headings.length}):`);
    for (const h of seo.headings.slice(0, 50)) lines.push(`  H${h.level}: ${h.text}`);
    if (seo.headings.length > 50) lines.push(`  …+${seo.headings.length - 50} more`);
  }
  lines.push('');
  lines.push('Page stats:');
  lines.push(`  Images: ${seo.images.total} (missing alt: ${seo.images.missing_alt})`);
  lines.push(`  Words: ${seo.word_count}`);
  lines.push(`  Internal links: ${seo.links.internal}`);
  lines.push(`  External links: ${seo.links.external}`);
  if (seo.flesch_reading_ease !== null) {
    lines.push(`  Flesch reading ease: ${seo.flesch_reading_ease}`);
  }
  return lines.join('\n');
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
