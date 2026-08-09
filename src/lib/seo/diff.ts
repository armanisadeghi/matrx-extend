/**
 * SEO audit diff — turn two audits of the same URL into a VERDICT.
 *
 * Why this exists: `extend.wbx_seo_audit` accumulates a saved audit every time
 * the user clicks Save, and the SEO tab used to render exactly one thing from
 * the previous row — its timestamp. "Last audited April 29" is a date, not an
 * answer (no-dead-ends doctrine, LAW 1 corollary 3: *a comparison must actually
 * compare*). The whole reason to save an audit is to answer "did my change
 * help?", so this module states the answer in words.
 *
 * Two rules shape the output:
 *   1. Every entry is a SENTENCE ("3 fewer images missing alt text"), not two
 *      numbers side by side that the user has to subtract themselves.
 *   2. Fields that did not change are NOT entries. They are counted into
 *      `unchanged` so the UI can say "9 other fields unchanged" in one line.
 *      A diff that lists 20 unchanged rows is as useless as a timestamp.
 *
 * Pure + dependency-free on purpose: the side panel renders it, and
 * `tests/unit/seo-diff.test.ts` pins every verdict string.
 */

import type { SeoAudit } from '@/lib/seo/audit';

/**
 * Whether a change is an improvement. Only claimed where the direction is
 * UNAMBIGUOUS — fewer images missing alt text is always better; more words is
 * not. Guessing on the ambiguous ones would be the same sin as showing a
 * timestamp: confident output that isn't an answer.
 */
export type SeoDiffDirection = 'better' | 'worse' | 'neutral';

export interface SeoDiffEntry {
  /** Stable id, for React keys and tests. */
  key: string;
  /** Short field name, e.g. "Missing alt text". */
  label: string;
  /** The verdict, as a sentence. This is the payload. */
  verdict: string;
  direction: SeoDiffDirection;
  /** Populated for text-valued fields so the UI can show before → after. */
  before?: string;
  after?: string;
  /** Extra lines (added/removed headings, gained/lost schema types). */
  items?: string[];
}

export interface SeoDiff {
  /** Only fields that actually changed, in display order. */
  entries: SeoDiffEntry[];
  /** Labels of the fields compared that were identical. */
  unchanged: string[];
  /** True when nothing at all changed — the UI should say so out loud. */
  identical: boolean;
}

/* ── signal parsing ──────────────────────────────────────────────────────── */

const num = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * A saved row's `signals` column is `unknown` — it is whatever the extension
 * wrote at the time, and older rows predate fields that exist today. So this
 * reads defensively field-by-field instead of validating the whole shape:
 * a row missing `links` must still diff its title, not be thrown away.
 */
export interface StoredAuditSignals {
  url: string | null;
  title: { value: string; length: number } | null;
  description: { value: string | null; length: number } | null;
  canonical: string | null;
  robots: string | null;
  schema_types: string[] | null;
  headings: { level: number; text: string }[] | null;
  links: { internal: number; external: number } | null;
  images: { total: number; missing_alt: number } | null;
  word_count: number | null;

  /* ── display-only fields ────────────────────────────────────────────────
   * Everything below is rendered by `SeoDetails` but NOT diffed. They are on
   * this type — rather than read straight off `SeoAudit` — because the SEO tab
   * renders live audits and saved history rows through one component, and a
   * saved row that could not show its own og tags would be a second, dumber
   * viewer of the same data.
   *
   * `saveSeoAudit` has always persisted the WHOLE audit into `signals`, so the
   * values are already sitting in every row ever written; only the parser was
   * dropping them. A row saved before a given field existed parses to `null`
   * and its group is simply omitted — same rule as everywhere else.
   *
   * Adding one to the diff is a deliberate, separate decision: `diffSeoAudits`
   * only claims a direction where the direction is unambiguous, and "og:image
   * changed" is not obviously better or worse. */
  lang: string | null;
  hreflang: { lang: string; href: string }[] | null;
  og: Record<string, string> | null;
  twitter: Record<string, string> | null;
  sentence_count: number | null;
  flesch_reading_ease: number | null;
  performance: {
    nav_type: string | null;
    duration_ms: number | null;
    transfer_size_bytes: number | null;
    http_status: number | null;
    redirect_count: number | null;
  } | null;
}

/** Page-controlled `<meta>` soup — keep only the string/string pairs. */
function strRecord(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

export function parseStoredSignals(signals: unknown): StoredAuditSignals | null {
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)) return null;
  const s = signals as Record<string, unknown>;

  const titleRaw = s.title as Record<string, unknown> | undefined;
  const title =
    titleRaw && typeof titleRaw === 'object'
      ? {
          value: str(titleRaw.value) ?? '',
          length: num(titleRaw.length) ?? (str(titleRaw.value) ?? '').length,
        }
      : null;

  const descRaw = s.description as Record<string, unknown> | undefined;
  const description =
    descRaw && typeof descRaw === 'object'
      ? {
          value: str(descRaw.value),
          length: num(descRaw.length) ?? (str(descRaw.value) ?? '').length,
        }
      : null;

  const headingsRaw = s.headings;
  const headings = Array.isArray(headingsRaw)
    ? headingsRaw.flatMap((h) => {
        if (!h || typeof h !== 'object') return [];
        const level = num((h as Record<string, unknown>).level);
        const text = str((h as Record<string, unknown>).text);
        return level === null || text === null ? [] : [{ level, text }];
      })
    : null;

  const linksRaw = s.links as Record<string, unknown> | undefined;
  const links =
    linksRaw && typeof linksRaw === 'object'
      ? { internal: num(linksRaw.internal) ?? 0, external: num(linksRaw.external) ?? 0 }
      : null;

  const imagesRaw = s.images as Record<string, unknown> | undefined;
  const images =
    imagesRaw && typeof imagesRaw === 'object'
      ? { total: num(imagesRaw.total) ?? 0, missing_alt: num(imagesRaw.missing_alt) ?? 0 }
      : null;

  const schemaRaw = s.schema_types;
  const schema_types = Array.isArray(schemaRaw)
    ? schemaRaw.filter((t): t is string => typeof t === 'string')
    : null;

  const hreflangRaw = s.hreflang;
  const hreflang = Array.isArray(hreflangRaw)
    ? hreflangRaw.flatMap((h) => {
        if (!h || typeof h !== 'object') return [];
        const lang = str((h as Record<string, unknown>).lang);
        const href = str((h as Record<string, unknown>).href);
        return lang === null || href === null ? [] : [{ lang, href }];
      })
    : null;

  const perfRaw = s.performance as Record<string, unknown> | undefined;
  const performance =
    perfRaw && typeof perfRaw === 'object' && !Array.isArray(perfRaw)
      ? {
          nav_type: str(perfRaw.nav_type),
          duration_ms: num(perfRaw.duration_ms),
          transfer_size_bytes: num(perfRaw.transfer_size_bytes),
          http_status: num(perfRaw.http_status),
          redirect_count: num(perfRaw.redirect_count),
        }
      : null;

  return {
    url: str(s.url),
    title,
    description,
    canonical: str(s.canonical),
    robots: str(s.robots),
    schema_types,
    headings,
    links,
    images,
    word_count: num(s.word_count),
    lang: str(s.lang),
    hreflang,
    og: strRecord(s.og),
    twitter: strRecord(s.twitter),
    sentence_count: num(s.sentence_count),
    flesch_reading_ease: num(s.flesch_reading_ease),
    performance,
  };
}

/** A live audit is already the right shape — this is the identity adapter. */
export function toStoredSignals(a: SeoAudit): StoredAuditSignals {
  return {
    url: a.url,
    title: a.title,
    description: a.description,
    canonical: a.canonical,
    robots: a.robots,
    schema_types: a.schema_types,
    headings: a.headings,
    links: a.links,
    images: a.images,
    word_count: a.word_count,
    lang: a.lang,
    hreflang: a.hreflang,
    og: a.og,
    twitter: a.twitter,
    sentence_count: a.sentence_count,
    flesch_reading_ease: a.flesch_reading_ease,
    performance: a.performance,
  };
}

/* ── phrasing helpers ────────────────────────────────────────────────────── */

const n = (v: number) => v.toLocaleString();

/** "3 more" / "3 fewer" — never "+3", which makes the reader do the work. */
function moreFewer(delta: number, unit: string, unitPlural = `${unit}s`): string {
  const abs = Math.abs(delta);
  const noun = abs === 1 ? unit : unitPlural;
  return `${n(abs)} ${delta > 0 ? 'more' : 'fewer'} ${noun}`;
}

function multiset(list: { level: number; text: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of list) {
    const k = `H${h.level} ${h.text}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function multisetMinus(a: Map<string, number>, b: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [k, count] of a) {
    const remaining = count - (b.get(k) ?? 0);
    for (let i = 0; i < remaining; i++) out.push(k);
  }
  return out;
}

/* ── the diff ────────────────────────────────────────────────────────────── */

/**
 * @param before The older (saved) audit's signals.
 * @param after  The newer audit's signals — usually the one on screen.
 */
export function diffSeoAudits(before: StoredAuditSignals, after: StoredAuditSignals): SeoDiff {
  const entries: SeoDiffEntry[] = [];
  const unchanged: string[] = [];

  const record = (label: string, entry: SeoDiffEntry | null) => {
    if (entry) entries.push(entry);
    else unchanged.push(label);
  };

  // ── Title ────────────────────────────────────────────────────────────────
  if (before.title && after.title) {
    const b = before.title;
    const a = after.title;
    if (b.value !== a.value) {
      const lenPart =
        b.length === a.length
          ? `still ${n(a.length)} chars`
          : `${n(b.length)} → ${n(a.length)} chars`;
      entries.push({
        key: 'title',
        label: 'Title',
        verdict: `Title rewritten (${lenPart})`,
        direction: 'neutral',
        before: b.value || '—',
        after: a.value || '—',
      });
    } else unchanged.push('Title');
  }

  // ── Description ──────────────────────────────────────────────────────────
  if (before.description && after.description) {
    const b = before.description;
    const a = after.description;
    if ((b.value ?? '') !== (a.value ?? '')) {
      let verdict: string;
      let direction: SeoDiffDirection = 'neutral';
      if (!b.value && a.value) {
        verdict = `Meta description added (${n(a.length)} chars)`;
        direction = 'better';
      } else if (b.value && !a.value) {
        verdict = 'Meta description removed';
        direction = 'worse';
      } else {
        verdict = `Meta description rewritten (${n(b.length)} → ${n(a.length)} chars)`;
      }
      entries.push({
        key: 'description',
        label: 'Description',
        verdict,
        direction,
        before: b.value ?? '—',
        after: a.value ?? '—',
      });
    } else unchanged.push('Description');
  }

  // ── Canonical / robots ───────────────────────────────────────────────────
  for (const [key, label] of [
    ['canonical', 'Canonical'],
    ['robots', 'Robots'],
  ] as const) {
    const b = before[key];
    const a = after[key];
    if (b === a) {
      unchanged.push(label);
      continue;
    }
    let verdict: string;
    if (!b && a) verdict = `${label} tag added`;
    else if (b && !a) verdict = `${label} tag removed`;
    else verdict = `${label} changed`;
    record(label, {
      key,
      label,
      verdict,
      // A robots change can flip a page out of the index — never call it neutral
      // silently; the before/after is right there for the user to judge.
      direction: 'neutral',
      before: b ?? '—',
      after: a ?? '—',
    });
  }

  // ── Headings ─────────────────────────────────────────────────────────────
  if (before.headings && after.headings) {
    const b = multiset(before.headings);
    const a = multiset(after.headings);
    const added = multisetMinus(a, b);
    const removed = multisetMinus(b, a);
    if (added.length === 0 && removed.length === 0) {
      unchanged.push('Headings');
    } else {
      const parts: string[] = [];
      if (added.length) parts.push(`${n(added.length)} added`);
      if (removed.length) parts.push(`${n(removed.length)} removed`);
      entries.push({
        key: 'headings',
        label: 'Headings',
        verdict: `Headings: ${parts.join(', ')} (${n(before.headings.length)} → ${n(after.headings.length)})`,
        direction: 'neutral',
        items: [
          ...added.slice(0, 5).map((h) => `+ ${h}`),
          ...removed.slice(0, 5).map((h) => `− ${h}`),
        ],
      });
    }
  }

  // ── Images + missing alt ─────────────────────────────────────────────────
  if (before.images && after.images) {
    const dTotal = after.images.total - before.images.total;
    if (dTotal === 0) unchanged.push('Images');
    else
      entries.push({
        key: 'images_total',
        label: 'Images',
        verdict: `${moreFewer(dTotal, 'image')} on the page (${n(before.images.total)} → ${n(after.images.total)})`,
        direction: 'neutral',
      });

    const dAlt = after.images.missing_alt - before.images.missing_alt;
    if (dAlt === 0) unchanged.push('Missing alt text');
    else
      entries.push({
        key: 'images_missing_alt',
        label: 'Missing alt text',
        verdict:
          after.images.missing_alt === 0
            ? `Every image now has alt text (was ${n(before.images.missing_alt)} missing)`
            : `${moreFewer(dAlt, 'image')} missing alt text (${n(before.images.missing_alt)} → ${n(after.images.missing_alt)})`,
        direction: dAlt < 0 ? 'better' : 'worse',
      });
  }

  // ── Word count ───────────────────────────────────────────────────────────
  if (before.word_count !== null && after.word_count !== null) {
    const d = after.word_count - before.word_count;
    if (d === 0) unchanged.push('Word count');
    else
      entries.push({
        key: 'word_count',
        label: 'Word count',
        verdict: `${moreFewer(d, 'word')} (${n(before.word_count)} → ${n(after.word_count)})`,
        direction: 'neutral',
      });
  }

  // ── Links ────────────────────────────────────────────────────────────────
  if (before.links && after.links) {
    for (const kind of ['internal', 'external'] as const) {
      const label = `${kind === 'internal' ? 'Internal' : 'External'} links`;
      const d = after.links[kind] - before.links[kind];
      if (d === 0) unchanged.push(label);
      else
        entries.push({
          key: `links_${kind}`,
          label,
          verdict: `${moreFewer(d, `${kind} link`)} (${n(before.links[kind])} → ${n(after.links[kind])})`,
          direction: 'neutral',
        });
    }
  }

  // ── Schema.org types ─────────────────────────────────────────────────────
  if (before.schema_types && after.schema_types) {
    const b = new Set(before.schema_types);
    const a = new Set(after.schema_types);
    const gained = [...a].filter((t) => !b.has(t));
    const lost = [...b].filter((t) => !a.has(t));
    if (gained.length === 0 && lost.length === 0) {
      unchanged.push('Structured data');
    } else {
      const parts: string[] = [];
      if (gained.length) parts.push(`gained ${gained.join(', ')}`);
      if (lost.length) parts.push(`lost ${lost.join(', ')}`);
      entries.push({
        key: 'schema_types',
        label: 'Structured data',
        verdict: `Structured data ${parts.join('; ')}`,
        // Losing a schema type kills a rich result; gaining one can win it.
        direction:
          lost.length && !gained.length
            ? 'worse'
            : gained.length && !lost.length
              ? 'better'
              : 'neutral',
      });
    }
  }

  return { entries, unchanged, identical: entries.length === 0 };
}

/** One-line headline for a history row: "3 changes" / "No changes". */
export function summarizeDiff(diff: SeoDiff): string {
  if (diff.identical) return 'No changes';
  const c = diff.entries.length;
  return `${c} change${c === 1 ? '' : 's'}`;
}
