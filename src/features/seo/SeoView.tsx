import { Button } from '@/components/ui/button';
import { useActiveTab } from '@/hooks/use-active-tab';
import type { SeoAudit } from '@/lib/seo/audit';
import { fetchLatestSeoAuditForUrl, saveSeoAudit } from '@/lib/supabase/queries';
import { CheckCircle2, Loader2, Save, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

export function SeoView() {
  const tab = useActiveTab();
  const [audit, setAudit] = useState<SeoAudit | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [previousAuditedAt, setPreviousAuditedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!tab.url) {
      setPreviousAuditedAt(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const prev = await fetchLatestSeoAuditForUrl(tab.url as string);
      if (cancelled) return;
      setPreviousAuditedAt(prev?.audited_at ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab.url]);

  const runAudit = async () => {
    if (!tab.id) return;
    setRunning(true);
    setSavedId(null);
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
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
          const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
          const word_count = text ? text.split(/\s+/).length : 0;
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
            word_count,
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

  const handleSave = async () => {
    if (!audit) return;
    setSaving(true);
    const r = await saveSeoAudit({
      url: audit.url,
      signals: audit,
      flesch_reading_ease: audit.flesch_reading_ease,
      word_count: audit.word_count,
    });
    setSaving(false);
    if (r) {
      setSavedId(r.id);
      setPreviousAuditedAt(new Date().toISOString());
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center px-3">
        <span className="text-sm font-medium">SEO audit</span>
        {previousAuditedAt && (
          <span className="ml-2 truncate text-xs text-muted-foreground">
            last {new Date(previousAuditedAt).toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 px-3 pb-3">
          {!audit ? (
            <div className="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground">
              Run an audit to see metadata, headings, images, and AI recommendations.
            </div>
          ) : (
            <>
              <Section label="Title & description">
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
              </Section>

              <Section label="Headings" hint={String(audit.headings.length)}>
                <div className="space-y-1 text-xs">
                  {audit.headings.slice(0, 30).map((h, i) => (
                    <div key={`${h.level}-${i}`} className="truncate">
                      <span className="mr-1.5 text-muted-foreground">H{h.level}</span>
                      {h.text}
                    </div>
                  ))}
                </div>
              </Section>

              <Section label="Images & content">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Images" value={audit.images.total} />
                  <Stat label="Missing alt" value={audit.images.missing_alt} />
                  <Stat label="Words" value={audit.word_count} />
                </div>
              </Section>

              <Section
                label="AI recommendations"
                icon={<Sparkles className="size-3.5 text-primary" />}
              >
                <div className="text-xs text-muted-foreground">
                  Wire this up to /ai/agent/execute with an SEO prompt.
                </div>
              </Section>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 px-3 pb-3 pt-1">
        <Button
          onClick={() => void runAudit()}
          disabled={running}
          className="flex-1 rounded-full"
        >
          {running ? <Loader2 className="animate-spin" /> : <Search />}
          {audit ? 'Re-audit' : 'Audit this page'}
        </Button>
        {audit && (
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            variant="secondary"
            className="rounded-full"
          >
            {saving ? <Loader2 className="animate-spin" /> : savedId ? <CheckCircle2 /> : <Save />}
            {savedId ? 'Saved' : 'Save'}
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
        {hint && <span className="ml-auto normal-case tracking-normal">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        {hint && <span>{hint}</span>}
      </div>
      <div className="break-words text-foreground">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-secondary/40 px-3 py-2.5">
      <div className="text-lg font-medium tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
