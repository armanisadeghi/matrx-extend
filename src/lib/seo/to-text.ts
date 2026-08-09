import type { StoredAuditSignals } from './diff';
import { fleschBand } from './flesch-bands';

/**
 * Plain-text rendering of an SEO audit — backs the SEO tab's "Summary (text)"
 * and "For AI agent" copy options.
 *
 * Lives here rather than inside `SeoView.tsx` for two reasons: it is pure
 * serialization with no React in it (its sibling `lib/scrape/to-markdown.ts`
 * sets that precedent), and vitest only collects `.ts` — inside a `.tsx`
 * component file it could not be tested at all, which is a large part of how
 * it drifted out of sync with `runAudit` in the first place.
 *
 * **This must stay a COMPLETE rendering of the audit.** It previously emitted
 * only title / description / canonical / robots / headings / images / words, so
 * Copy and the "For AI agent" payload silently dropped hreflang, og, twitter,
 * schema types, lang, the link counts, sentence count, the Flesch score, and
 * the performance block. That is worse than an incomplete UI: an agent handed
 * that text concludes the page HAS no social tags, rather than that we never
 * looked. Add a field to `SeoAudit` → render it here in the same change.
 *
 * Empty groups are omitted rather than printed as dashes, matching the UI and
 * CLAUDE.md's "no shallow keys for empty things".
 *
 * Takes `StoredAuditSignals` so the same function serializes a live audit and a
 * saved history snapshot — copying a snapshot must not silently produce a
 * thinner document than copying the live audit.
 */
export function seoAuditToText(a: StoredAuditSignals): string {
  const lines: string[] = [];
  lines.push(`URL: ${a.url ?? '—'}`);
  lines.push(`Title (${a.title?.length ?? 0} chars): ${a.title?.value || '—'}`);
  lines.push(`Description (${a.description?.length ?? 0} chars): ${a.description?.value ?? '—'}`);
  lines.push(`Canonical: ${a.canonical ?? '—'}`);
  lines.push(`Robots: ${a.robots ?? '—'}`);

  const hreflang = a.hreflang ?? [];
  if (a.lang || hreflang.length > 0) {
    lines.push('');
    lines.push('International:');
    if (a.lang) lines.push(`  Page language: ${a.lang}`);
    if (hreflang.length > 0) {
      lines.push(`  Hreflang alternates (${hreflang.length}):`);
      for (const h of hreflang) lines.push(`    ${h.lang}: ${h.href}`);
    }
  }

  const og = Object.entries(a.og ?? {});
  const twitter = Object.entries(a.twitter ?? {});
  if (og.length > 0 || twitter.length > 0) {
    lines.push('');
    lines.push('Social preview tags:');
    for (const [k, v] of og) lines.push(`  ${k}: ${v}`);
    for (const [k, v] of twitter) lines.push(`  ${k}: ${v}`);
  }

  const schemaTypes = a.schema_types ?? [];
  if (schemaTypes.length > 0) {
    lines.push('');
    lines.push(`Structured data (${schemaTypes.length}): ${schemaTypes.join(', ')}`);
  }

  const headings = a.headings ?? [];
  if (headings.length > 0) {
    lines.push('');
    lines.push(`Headings (${headings.length}):`);
    for (const h of headings.slice(0, 50)) lines.push(`  H${h.level}: ${h.text}`);
    if (headings.length > 50) lines.push(`  …+${headings.length - 50} more`);
  }

  lines.push('');
  lines.push('Page stats:');
  lines.push(`  Images: ${a.images?.total ?? 0} (missing alt: ${a.images?.missing_alt ?? 0})`);
  lines.push(`  Words: ${a.word_count ?? 0}`);
  if (a.sentence_count !== null) lines.push(`  Sentences: ${a.sentence_count}`);
  if (a.links) {
    lines.push(`  Internal links: ${a.links.internal}`);
    lines.push(`  External links: ${a.links.external}`);
  }

  const band = fleschBand(a.flesch_reading_ease);
  if (a.flesch_reading_ease !== null && band) {
    lines.push(`  Flesch reading ease: ${a.flesch_reading_ease} (${band.summary})`);
  }

  const p = a.performance;
  if (
    p &&
    (p.nav_type !== null ||
      p.duration_ms !== null ||
      p.transfer_size_bytes !== null ||
      p.http_status !== null ||
      p.redirect_count !== null)
  ) {
    lines.push('');
    lines.push('Performance:');
    if (p.http_status !== null) lines.push(`  HTTP status: ${p.http_status}`);
    if (p.nav_type !== null) lines.push(`  Navigation type: ${p.nav_type}`);
    if (p.redirect_count !== null) lines.push(`  Redirect hops: ${p.redirect_count}`);
    if (p.duration_ms !== null) lines.push(`  Load duration: ${p.duration_ms} ms`);
    if (p.transfer_size_bytes !== null) {
      lines.push(`  Transfer size: ${p.transfer_size_bytes} bytes`);
    }
  }

  return lines.join('\n');
}
