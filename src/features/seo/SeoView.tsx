import { CopyButton, CopyMenu } from '@/components/CopyMenu';
import { Button } from '@/components/ui/button';
import { useActiveTab } from '@/hooks/use-active-tab';
import { stringifyJson, wrapForAgent } from '@/lib/clipboard/copy';
import { captureWithFallback } from '@/lib/scrape/capture-with-fallback';
import type { SeoAudit } from '@/lib/seo/audit';
import { fetchLatestSeoAuditForUrl, saveSeoAudit } from '@/lib/supabase/queries';
import { CheckCircle2, Loader2, Save, Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function SeoView() {
  const tab = useActiveTab();
  const [audit, setAudit] = useState<SeoAudit | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [previousAuditedAt, setPreviousAuditedAt] = useState<string | null>(null);
  /**
   * Tracks the URL we've already auto-run an audit for, so opening the SEO
   * tab fires once per page (and re-fires on navigation) but doesn't loop
   * after the audit state updates. Manual "Re-audit" is unrelated — it
   * always runs on click.
   */
  const lastAutoRunUrlRef = useRef<string | null>(null);

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

  // Auto-run an audit when the SEO tab gets a fresh URL — first mount, or
  // user navigates the active tab. Manual "Re-audit" stays as the way to
  // refresh against the same URL. Errors are already caught + logged inside
  // runAudit, so a restricted page (chrome://) just no-ops gracefully.
  useEffect(() => {
    if (!tab.id || !tab.url) return;
    if (lastAutoRunUrlRef.current === tab.url) return;
    lastAutoRunUrlRef.current = tab.url;
    void runAudit();
    // runAudit is defined in the component body and reads the latest tab
    // state via closure; we only want this effect to fire on URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.url]);

  const [auditError, setAuditError] = useState<string | null>(null);
  // Live tab snapshot for the out-of-order guard above.
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const runAudit = async () => {
    if (!tab.id) return;
    setRunning(true);
    setSavedId(null);
    setAuditError(null);
    const requestedTab = tab.id;
    const requestedUrl = tab.url;
    try {
      // ONE code path: the content script's full collector (lib/seo/audit)
      // via the shared capture primitive. The previous hand-rolled inline
      // func HARDCODED links {internal:0, external:0}, empty schema_types/
      // hreflang, and flesch_reading_ease null — Copy presented those as
      // real measurements and Save persisted them to wbx_seo_audit.
      const cap = await captureWithFallback(requestedTab, requestedUrl ?? null);
      // Out-of-order / navigation guard: a slow audit of page A must not
      // overwrite page B's fresh state.
      if (tabRef.current.id !== requestedTab || tabRef.current.url !== requestedUrl) return;
      if (!cap.ok || !cap.soup) {
        setAudit(null);
        setAuditError(
          cap.reason === 'unreachable-url'
            ? 'This page cannot be audited (browser-internal or restricted URL).'
            : `Audit failed: ${cap.detail ?? cap.reason ?? 'unknown error'}`,
        );
        return;
      }
      setAudit(cap.soup.seo);
    } catch (err) {
      setAudit(null);
      setAuditError(`Audit failed: ${(err as Error).message}`);
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
    } else {
      setAuditError('Save failed — check your connection and sign-in, then try again.');
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
        {audit && (
          <div className="ml-auto">
            <CopyMenu
              title="Copy audit"
              options={[
                {
                  label: 'Summary (text)',
                  getContent: () => seoAuditToText(audit),
                },
                {
                  label: 'For AI agent',
                  ai: true,
                  getContent: () =>
                    wrapForAgent({
                      description: 'an SEO audit for a webpage',
                      source: { url: audit.url, title: audit.title.value },
                      format: 'text',
                      content: seoAuditToText(audit),
                    }),
                },
                {
                  label: 'JSON',
                  adminOnly: true,
                  getContent: () => stringifyJson(audit),
                },
              ]}
            />
          </div>
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
        <Button onClick={() => void runAudit()} disabled={running} className="flex-1 rounded-full">
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
      {auditError && (
        <div className="px-3 pb-2 text-[11px] text-red-600 dark:text-red-400">{auditError}</div>
      )}
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
    <div className="group text-xs">
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <div className="flex items-center gap-1">
          {hint && <span>{hint}</span>}
          {value && value !== '—' && (
            <CopyButton
              text={value}
              title={`Copy ${label.toLowerCase()}`}
              size="xs"
              className="opacity-0 transition-opacity group-hover:opacity-100"
            />
          )}
        </div>
      </div>
      <div className="break-words text-foreground">{value}</div>
    </div>
  );
}

function seoAuditToText(a: SeoAudit): string {
  const lines: string[] = [];
  lines.push(`URL: ${a.url}`);
  lines.push(`Title (${a.title.length} chars): ${a.title.value || '—'}`);
  lines.push(`Description (${a.description.length} chars): ${a.description.value ?? '—'}`);
  lines.push(`Canonical: ${a.canonical ?? '—'}`);
  lines.push(`Robots: ${a.robots ?? '—'}`);
  lines.push('');
  lines.push(`Headings (${a.headings.length}):`);
  for (const h of a.headings.slice(0, 50)) lines.push(`  H${h.level}: ${h.text}`);
  if (a.headings.length > 50) lines.push(`  …+${a.headings.length - 50} more`);
  lines.push('');
  lines.push('Page stats:');
  lines.push(`  Images: ${a.images.total} (missing alt: ${a.images.missing_alt})`);
  lines.push(`  Words: ${a.word_count}`);
  return lines.join('\n');
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-secondary/40 px-3 py-2.5">
      <div className="text-lg font-medium tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
