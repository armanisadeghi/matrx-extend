import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useActiveTab } from '@/hooks/use-active-tab';
import type { SeoAudit } from '@/lib/seo/audit';
import { Loader2, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';

export function SeoView() {
  const tab = useActiveTab();
  const [audit, setAudit] = useState<SeoAudit | null>(null);
  const [running, setRunning] = useState(false);

  const runAudit = async () => {
    if (!tab.id) return;
    setRunning(true);
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Inline minimal audit. Full audit lives in src/lib/seo/audit.ts and
          // would be loaded via dynamic import when running in a content script.
          const og: Record<string, string> = {};
          const twitter: Record<string, string> = {};
          document.querySelectorAll('meta').forEach((m) => {
            const property = m.getAttribute('property') ?? '';
            const name = m.getAttribute('name') ?? '';
            const content = m.getAttribute('content') ?? '';
            if (!content) return;
            if (property.startsWith('og:')) og[property] = content;
            if (name.startsWith('twitter:')) twitter[name] = content;
          });
          const headings = Array.from(
            document.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'),
          )
            .map((h) => ({ level: Number(h.tagName.slice(1)), text: (h.textContent ?? '').trim() }))
            .slice(0, 200);
          const imgs = document.querySelectorAll<HTMLImageElement>('img');
          const missing_alt = Array.from(imgs).filter(
            (i) => !i.alt || i.alt.trim().length === 0,
          ).length;
          const desc =
            document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? null;
          const robots =
            document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content ?? null;
          const canonical =
            document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
          return {
            url: location.href,
            fetched_at: Date.now(),
            title: { value: document.title, length: document.title.length },
            description: { value: desc, length: desc?.length ?? 0 },
            canonical,
            robots,
            hreflang: [],
            og,
            twitter,
            schema_types: [],
            headings,
            links: { internal: 0, external: 0 },
            images: { total: imgs.length, missing_alt },
            word_count: 0,
            flesch_reading_ease: null,
            performance: { nav_type: null, duration_ms: null, transfer_size_bytes: null },
          } as SeoAudit;
        },
      });
      const data = (result?.[0]?.result ?? null) as SeoAudit | null;
      setAudit(data);
    } catch (err) {
      console.warn('[matrx-extend] audit failed', err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <Button onClick={() => void runAudit()} disabled={running} className="w-full">
          {running ? <Loader2 className="animate-spin" /> : <Search />}
          Audit this page
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {!audit ? (
            <div className="grid place-items-center py-12 text-sm text-muted-foreground">
              No audit yet — click "Audit this page".
            </div>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Title & description</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <Field
                    label="Title"
                    value={audit.title.value}
                    hint={`${audit.title.length} chars`}
                  />
                  <Field
                    label="Description"
                    value={audit.description.value ?? '—'}
                    hint={`${audit.description.length} chars`}
                  />
                  <Field label="Canonical" value={audit.canonical ?? '—'} />
                  <Field label="Robots" value={audit.robots ?? '—'} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center justify-between">
                    Headings <Badge variant="secondary">{audit.headings.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 text-xs">
                    {audit.headings.slice(0, 30).map((h, i) => (
                      <div key={`${h.level}-${i}`} className="truncate">
                        <span className="text-muted-foreground">H{h.level}</span> {h.text}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Images</CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-1">
                  <div>Total: {audit.images.total}</div>
                  <div>Missing alt: {audit.images.missing_alt}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="size-4" /> AI recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Wire this up to /ai/agent/execute with an SEO prompt to generate suggestions.
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        {hint && <span>{hint}</span>}
      </div>
      <div className="break-words text-foreground">{value}</div>
    </div>
  );
}
