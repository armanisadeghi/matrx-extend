/**
 * SeoAudit → evaluator inputs. **This file is NOT a mirror** — it is the
 * extension-only adapter between `src/lib/seo/audit.ts`'s nested display shape
 * and the byte-parity evaluators in this directory (which take the server's
 * flat names). Everything else here mirrors `audit_metrics.py`; see
 * `./types.ts`.
 *
 * The 1:1 field mapping documented in `audit.ts`'s header, applied:
 *   og / twitter          → socialInputFromRawTags (already the raw
 *                           "og:title"-keyed wire shape the Python consumes)
 *   headings              → HeadingEntryInput[] (same {level, text})
 *   robots                → metaRobots
 *   canonical             → canonicalUrl
 *   url                   → finalUrl, and the url-quality input
 *   performance.http_status    → httpStatus
 *   performance.redirect_count → redirectChain length (see below)
 *
 * TWO HONEST LIMITS, both under-report rather than over-report:
 *
 * 1. `empty_count` is structurally always 0 here. `audit.ts` skips
 *    empty-text headings while collecting (mirroring `seo_audit.py`'s
 *    collector), so a blank <h2> never reaches the evaluator. The crawler's
 *    `headings.all` keeps them and DOES report them. Not a parity break in the
 *    evaluator — a difference in what the two collectors can see — but do not
 *    "fix" it by synthesizing entries.
 *
 * 2. The browser exposes a redirect COUNT (`PerformanceNavigationTiming.
 *    redirectCount`), never the intermediate URLs. The evaluator only reads
 *    `redirectChain.length`, so the chain is reconstructed at the right LENGTH
 *    with the hop URLs left empty and explicitly marked unobserved. Only the
 *    final URL is real. Nothing in the extension persists or renders the hop
 *    entries; if that ever changes, render `''` as "not observed", never as a
 *    URL.
 */

import type { SeoAudit } from '@/lib/seo/audit';
import {
  type HeadingEntryInput,
  type HeadingStructureEvaluation,
  evaluateHeadingStructure,
} from './headings';
import {
  type IndexabilityEvaluation,
  type IndexabilityInput,
  type RedirectHopInput,
  evaluateIndexability,
} from './indexability';
import { type SocialCardEvaluation, type SocialCardInput, evaluateSocialCard } from './social';
import { socialInputFromRawTags } from './stored';
import type { AuditIssue, AuditSeverity } from './types';
import { type UrlQualityEvaluation, evaluateUrlQuality } from './url-quality';

export type SeoSection = 'indexability' | 'social' | 'headings' | 'url';

/** An issue plus the section it came from, for a single ranked list. */
export interface SeoFinding extends AuditIssue {
  section: SeoSection;
}

export interface SeoEvaluation {
  social: SocialCardEvaluation;
  headings: HeadingStructureEvaluation;
  indexability: IndexabilityEvaluation;
  url: UrlQualityEvaluation;
  /** Every issue, errors first, then by section severity-of-consequence. */
  findings: SeoFinding[];
  errorCount: number;
  warningCount: number;
  /**
   * Mirrors `StoredAuditMetrics.overall_ok`: social + headings +
   * indexability. The url section is warnings-only and deliberately excluded.
   */
  overallOk: boolean;
}

/** Consequence order — a blocked page matters more than an ugly slug. */
const SECTION_ORDER: SeoSection[] = ['indexability', 'social', 'headings', 'url'];
const SEVERITY_ORDER: AuditSeverity[] = ['error', 'warning'];

export function socialInputFromAudit(audit: SeoAudit): SocialCardInput {
  return socialInputFromRawTags(audit.og, audit.twitter);
}

export function headingInputsFromAudit(audit: SeoAudit): HeadingEntryInput[] {
  return audit.headings.map((h) => ({ level: h.level, text: h.text }));
}

/**
 * Reconstruct the redirect chain at the LENGTH the browser reports. Hop URLs
 * are `''` — unobserved, never guessed. See limit (2) in the file header.
 */
export function redirectChainFromAudit(audit: SeoAudit): RedirectHopInput[] {
  const count = audit.performance.redirect_count;
  if (typeof count !== 'number' || count <= 0) return [];
  const hops: RedirectHopInput[] = [];
  for (let i = 0; i < count; i += 1) hops.push({ url: '', status: null });
  hops.push({ url: audit.url, status: audit.performance.http_status });
  return hops;
}

export function indexabilityInputFromAudit(audit: SeoAudit): IndexabilityInput {
  return {
    httpStatus: audit.performance.http_status,
    metaRobots: audit.robots,
    canonicalUrl: audit.canonical,
    redirectChain: redirectChainFromAudit(audit),
    finalUrl: audit.url || null,
  };
}

/** Run all four evaluators over one live-DOM audit and rank the findings. */
export function evaluateSeoAudit(audit: SeoAudit): SeoEvaluation {
  const social = evaluateSocialCard(socialInputFromAudit(audit));
  const headings = evaluateHeadingStructure(headingInputsFromAudit(audit));
  const indexability = evaluateIndexability(indexabilityInputFromAudit(audit));
  const url = evaluateUrlQuality(audit.url);

  const findings: SeoFinding[] = [
    ...indexability.issues.map((issue) => ({ ...issue, section: 'indexability' as const })),
    ...social.issues.map((issue) => ({ ...issue, section: 'social' as const })),
    ...headings.issues.map((issue) => ({ ...issue, section: 'headings' as const })),
    ...url.issues.map((issue) => ({ ...issue, section: 'url' as const })),
  ].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section),
  );

  return {
    social,
    headings,
    indexability,
    url,
    findings,
    errorCount: findings.filter((f) => f.severity === 'error').length,
    warningCount: findings.filter((f) => f.severity === 'warning').length,
    overallOk: social.ok && headings.ok && indexability.ok,
  };
}

export const SECTION_LABELS: Record<SeoSection, string> = {
  indexability: 'Indexing',
  social: 'Social share card',
  headings: 'Page structure',
  url: 'URL',
};

/**
 * The exact `<meta>` tags this page is missing, filled from what the page
 * already knows (its own title / description / canonical). A real mechanical
 * fix: the user pastes this into their page's `<head>`.
 *
 * Returns `null` when nothing is missing.
 */
export function missingSocialTagsSnippet(
  audit: SeoAudit,
  social: SocialCardEvaluation,
): string | null {
  const lines: string[] = [];
  const esc = (value: string) => value.replace(/"/g, '&quot;');
  if (!social.title && audit.title.value)
    lines.push(`<meta property="og:title" content="${esc(audit.title.value)}" />`);
  if (!social.description && audit.description.value)
    lines.push(`<meta property="og:description" content="${esc(audit.description.value)}" />`);
  if (!social.url && (audit.canonical || audit.url))
    lines.push(`<meta property="og:url" content="${esc(audit.canonical ?? audit.url)}" />`);
  if (!social.ogType) lines.push('<meta property="og:type" content="website" />');
  if (!social.cardType) lines.push('<meta name="twitter:card" content="summary_large_image" />');
  if (!social.image)
    lines.push('<meta property="og:image" content="https://example.com/your-share-image.png" />');
  return lines.length ? lines.join('\n') : null;
}
