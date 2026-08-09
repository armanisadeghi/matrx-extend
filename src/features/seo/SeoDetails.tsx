import { OpenUrl } from '@/components/OpenUrl';
import type { StoredAuditSignals } from '@/lib/seo/diff';
import { fleschBand } from '@/lib/seo/flesch-bands';
import { isOpenableUrl, schemaTypeUrl } from '@/lib/url/openable';
import { cn } from '@/lib/utils';
import { ImageOff } from 'lucide-react';
import { useState } from 'react';

/**
 * The one renderer for an SEO audit's collected values.
 *
 * Consumed by the SEO tab (live audit AND saved history snapshot) and by the
 * Scrape tab's SEO panel. Those were two hand-rolled renderers of the same
 * struct and they had drifted badly: the SEO tab showed roughly a third of what
 * `runAudit` collects, silently dropping `hreflang`, `og`, `twitter`,
 * `schema_types`, `lang`, `flesch_reading_ease`, `sentence_count`, the whole
 * `performance` block, and — worst — the internal/external link counts it had
 * gone to the trouble of computing, persisting to `extend.wbx_seo_audit`, and
 * shipping into agent context.
 *
 * It takes `StoredAuditSignals` rather than `SeoAudit` so a saved row renders
 * through this same component instead of a second, dumber viewer. Every field
 * on that type is nullable for a real reason: a row saved before a field
 * existed genuinely does not have it.
 *
 * Two rules govern everything below.
 *
 * 1. **Group by the user's mental model, not by the struct.** `lang` and
 *    `hreflang` answer one question ("who is this page for?"), not two.
 *    `og` + `twitter` exist to produce a share card, so we draw the share card
 *    — reading `og:image → https://…` and simulating the render in your head
 *    is work the UI should have done.
 * 2. **Omit empty groups; never render them as zeros or dashes.** This is the
 *    UI half of CLAUDE.md's context rule ("no shallow keys for empty things").
 *    Absence of a section is information. A row of dashes is noise the user
 *    reads past every single time, and a `0` invites the reader to believe we
 *    measured something we didn't.
 *
 * Door Law: every URL here goes through `<OpenUrl>` and every schema.org type
 * links to its documentation. A URL rendered as dead text is the exact defect
 * this component exists to remove.
 *
 * Layout target is a ~360px side panel with NO horizontal scroll — URLs use
 * `break-all` (they have no spaces to wrap at), text truncates, and stat grids
 * stay at two narrow columns.
 */
export function SeoDetails({ signals }: { signals: StoredAuditSignals }) {
  const og = signals.og ?? {};
  const twitter = signals.twitter ?? {};
  const hreflang = signals.hreflang ?? [];
  const headings = signals.headings ?? [];
  const schemaTypes = signals.schema_types ?? [];
  const links = signals.links;
  const images = signals.images;
  const perf = signals.performance;

  const hasSocial = Object.keys(og).length > 0 || Object.keys(twitter).length > 0;
  const hasIntl = Boolean(signals.lang) || hreflang.length > 0;
  const hasLinks = Boolean(links) && (links!.internal > 0 || links!.external > 0);
  const hasReadability =
    (signals.word_count ?? 0) > 0 ||
    (signals.sentence_count ?? 0) > 0 ||
    signals.flesch_reading_ease !== null;
  const hasPerf =
    perf !== null &&
    (perf.nav_type !== null ||
      perf.duration_ms !== null ||
      perf.transfer_size_bytes !== null ||
      perf.http_status !== null ||
      perf.redirect_count !== null);

  return (
    <div className="space-y-4">
      <SeoGroup label="Title & description">
        <SeoRow
          label="Title"
          value={signals.title?.value || '—'}
          {...(signals.title ? { hint: `${signals.title.length} chars` } : {})}
        />
        <SeoRow
          label="Description"
          value={signals.description?.value ?? '—'}
          {...(signals.description ? { hint: `${signals.description.length} chars` } : {})}
        />
        {signals.canonical && <SeoRow label="Canonical" url={signals.canonical} />}
        {signals.robots && <SeoRow label="Robots" value={signals.robots} />}
      </SeoGroup>

      {hasSocial && <SocialPreviewGroup signals={signals} og={og} twitter={twitter} />}

      {hasIntl && (
        <SeoGroup
          label="International"
          hint={hreflang.length > 0 ? `${hreflang.length} alternates` : undefined}
        >
          {signals.lang && <SeoRow label="Page language" value={signals.lang} />}
          {hreflang.length > 0 && (
            <div className="space-y-1 py-1 text-xs">
              {hreflang.map((h, i) => (
                <div key={`${h.lang}-${h.href}-${i}`} className="flex gap-2">
                  <span className="w-14 shrink-0 truncate font-mono text-muted-foreground">
                    {h.lang}
                  </span>
                  <OpenUrl url={h.href} mono className="text-xs" />
                </div>
              ))}
            </div>
          )}
        </SeoGroup>
      )}

      {schemaTypes.length > 0 && (
        <SeoGroup label="Structured data" hint={String(schemaTypes.length)}>
          <div className="flex flex-wrap gap-1 py-1">
            {schemaTypes.map((t) => (
              <SchemaTypeChip key={t} type={t} />
            ))}
          </div>
        </SeoGroup>
      )}

      {headings.length > 0 && (
        <SeoGroup label="Headings" hint={String(headings.length)}>
          <div className="space-y-1 py-1 text-xs">
            {headings.slice(0, HEADING_DISPLAY_LIMIT).map((h, i) => (
              <div key={`${h.level}-${i}`} className="truncate">
                <span className="mr-1.5 text-muted-foreground">H{h.level}</span>
                {h.text}
              </div>
            ))}
            {headings.length > HEADING_DISPLAY_LIMIT && (
              <div className="text-[10px] text-muted-foreground">
                +{headings.length - HEADING_DISPLAY_LIMIT} more
              </div>
            )}
          </div>
        </SeoGroup>
      )}

      {hasLinks && links && (
        <SeoGroup label="Links" hint={String(links.internal + links.external)}>
          <div className="grid grid-cols-2 gap-2 py-1">
            <SeoStat label="Internal" value={links.internal} />
            <SeoStat label="External" value={links.external} />
          </div>
        </SeoGroup>
      )}

      {images && images.total > 0 && (
        <SeoGroup label="Images" hint={String(images.total)}>
          <div className="grid grid-cols-2 gap-2 py-1">
            <SeoStat label="Total" value={images.total} />
            <SeoStat
              label="Missing alt"
              value={images.missing_alt}
              tone={images.missing_alt > 0 ? 'warn' : 'ok'}
            />
          </div>
        </SeoGroup>
      )}

      {hasReadability && <ReadabilityGroup signals={signals} />}

      {hasPerf && perf && (
        <SeoGroup label="Performance">
          {perf.http_status !== null && (
            <SeoRow label="HTTP status" value={String(perf.http_status)} />
          )}
          {perf.nav_type !== null && <SeoRow label="Navigation" value={perf.nav_type} />}
          {perf.redirect_count !== null && perf.redirect_count > 0 && (
            <SeoRow
              label="Redirects"
              value={`${perf.redirect_count} hop${perf.redirect_count === 1 ? '' : 's'}`}
            />
          )}
          {perf.duration_ms !== null && (
            <SeoRow label="Load duration" value={`${perf.duration_ms.toLocaleString()} ms`} />
          )}
          {perf.transfer_size_bytes !== null && (
            <SeoRow label="Transfer size" value={formatBytes(perf.transfer_size_bytes)} />
          )}
        </SeoGroup>
      )}
    </div>
  );
}

const HEADING_DISPLAY_LIMIT = 50;

/* ── social preview ──────────────────────────────────────────────────────── */

/**
 * og/twitter tags exist for exactly one purpose: to control the card Slack,
 * iMessage, Twitter, and LinkedIn draw when the page is shared. So draw the
 * card. The raw tags stay listed underneath for whoever wants them.
 *
 * Twitter tags are the documented fallback for their og counterparts, so this
 * resolves `og:*` first then `twitter:*` — which is what the consuming
 * platforms actually do — and finally falls back to the page's own title and
 * description, which is what they show when neither tag is present.
 */
function SocialPreviewGroup({
  signals,
  og,
  twitter,
}: {
  signals: StoredAuditSignals;
  og: Record<string, string>;
  twitter: Record<string, string>;
}) {
  const image = og['og:image'] ?? twitter['twitter:image'];
  const title = og['og:title'] ?? twitter['twitter:title'] ?? signals.title?.value ?? '';
  const description =
    og['og:description'] ??
    twitter['twitter:description'] ??
    signals.description?.value ??
    '';
  const siteName = og['og:site_name'] ?? twitter['twitter:site'] ?? hostOf(signals.url);
  const target = og['og:url'] ?? signals.url ?? undefined;

  return (
    <SeoGroup label="Social preview" hint={twitter['twitter:card'] ?? og['og:type']}>
      <div className="space-y-2 py-1">
        <div className="overflow-hidden rounded-lg border bg-background">
          <PreviewImage src={image} />
          <div className="space-y-0.5 p-2">
            {siteName && (
              <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                {siteName}
              </div>
            )}
            <div className="line-clamp-2 text-xs font-medium">{title || '—'}</div>
            {description && (
              <div className="line-clamp-3 text-[11px] text-muted-foreground">{description}</div>
            )}
            {isOpenableUrl(target) && (
              <div className="pt-1">
                <OpenUrl url={target} mono className="text-[10px]" />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1 text-xs">
          {[...Object.entries(og), ...Object.entries(twitter)].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="w-28 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                {k}
              </span>
              {isOpenableUrl(v) ? (
                <OpenUrl url={v} mono className="text-[11px]" />
              ) : (
                <span className="min-w-0 break-words text-[11px]">{v}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </SeoGroup>
  );
}

/**
 * `og:image` points at someone else's server. It can be relative, dead,
 * hotlink-blocked, or behind auth, so a load failure is a normal outcome — not
 * a broken-image glyph. The fallback still states that an image tag EXISTS,
 * which is the SEO-relevant fact, and distinguishes that from having none.
 */
function PreviewImage({ src }: { src: string | undefined }) {
  const [failed, setFailed] = useState(false);

  if (!isOpenableUrl(src) || failed) {
    return (
      <div className="flex aspect-[1.91/1] w-full items-center justify-center gap-1.5 bg-secondary/40 text-[10px] text-muted-foreground">
        <ImageOff className="size-3.5" />
        {src ? 'Preview image failed to load' : 'No preview image'}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Social preview"
      className="aspect-[1.91/1] w-full bg-secondary/40 object-cover"
      onError={() => setFailed(true)}
    />
  );
}

/* ── readability ─────────────────────────────────────────────────────────── */

/**
 * A raw Flesch score is unreadable to the non-technical SME this extension is
 * built for: "62.4" means nothing on its own. The standard band carries the
 * meaning and the number is the supporting detail. Word and sentence counts
 * live here because they are the score's two inputs — this is the group where
 * "why is it that number?" gets answered.
 */
function ReadabilityGroup({ signals }: { signals: StoredAuditSignals }) {
  const score = signals.flesch_reading_ease;
  const band = fleschBand(score);
  return (
    <SeoGroup label="Readability">
      {band && score !== null && (
        <div className="py-1.5">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-xl font-semibold tabular-nums',
                band.tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
                band.tone === 'warn' && 'text-amber-600 dark:text-amber-400',
              )}
            >
              {score}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Flesch reading ease
            </span>
          </div>
          <div className="text-xs text-foreground">{band.summary}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 py-1">
        <SeoStat label="Words" value={signals.word_count ?? 0} />
        <SeoStat label="Sentences" value={signals.sentence_count ?? 0} />
      </div>
    </SeoGroup>
  );
}

/* ── shared presentational pieces ────────────────────────────────────────── */

function SchemaTypeChip({ type }: { type: string }) {
  const href = schemaTypeUrl(type);
  // Show the short name — a microdata `itemtype` is a full URL and would blow
  // out the chip row at 360px — but keep the full value reachable via the link.
  const shown = type.replace(/^https?:\/\/(?:www\.)?schema\.org\//i, '');
  if (!href) {
    return (
      <span className="rounded-full bg-secondary/40 px-2 py-0.5 font-mono text-[10px]">{shown}</span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={`Open ${type} on schema.org`}
      className="rounded-full bg-secondary/40 px-2 py-0.5 font-mono text-[10px] text-sky-600 hover:bg-secondary dark:text-sky-400"
    >
      {shown}
    </a>
  );
}

function SeoGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {hint && (
          <span className="min-w-0 truncate text-[10px] tabular-nums text-muted-foreground/70">
            {hint}
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="divide-y divide-border/60 px-3 py-2 text-sm">{children}</div>
      </div>
    </div>
  );
}

/**
 * One label/value line. Pass `url` instead of `value` when the value is a
 * destination — that routes it through the `<OpenUrl>` door instead of
 * rendering it as dead text.
 */
function SeoRow({
  label,
  value,
  url,
  hint,
}: {
  label: string;
  value?: string | undefined;
  url?: string | undefined;
  hint?: string | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-baseline gap-2">
        {hint && <span className="shrink-0 text-[10px] text-muted-foreground/70">{hint}</span>}
        {url !== undefined ? (
          <OpenUrl url={url} mono className="text-right text-xs" />
        ) : (
          <span className="min-w-0 break-words text-right text-xs">{value}</span>
        )}
      </div>
    </div>
  );
}

function SeoStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'ok' | 'warn';
}) {
  return (
    <div className="rounded-lg bg-secondary/40 px-2.5 py-1.5">
      <div
        className={cn(
          'text-base font-semibold tabular-nums',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
          tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
        )}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString()} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
