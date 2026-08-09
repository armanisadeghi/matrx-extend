/**
 * Flesch Reading Ease → plain-English band.
 *
 * DISPLAY ONLY. This file interprets a score; it never computes one. The score
 * itself comes from `runAudit` in ./audit.ts, which is a declared byte-parity
 * mirror of `matrx_scraper/seo_audit.py::_flesch_reading_ease`. Nothing here
 * may feed back into that calculation.
 *
 * The bands are the STANDARD Flesch table (Flesch 1948, as tabulated by
 * Flesch–Kincaid and reproduced by every readability tool) — not tuned, not
 * invented. Boundaries are inclusive-low / exclusive-high, and the table is
 * walked top-down so a score of exactly 60 lands in "Plain English", 70 in
 * "Fairly easy", etc.
 *
 * A raw score is unreadable to the SME this extension is built for: "62.4"
 * means nothing, "Plain English — 8th–9th grade" means everything. The number
 * is still shown; the band is what makes it actionable.
 *
 * Note the scale is NOT clamped to 0–100. `audit.ts` clamps to ±999.99 (the DB
 * column's range), so a pathological page — one 4,000-word "sentence", or a
 * page of single-syllable words with no punctuation — legitimately scores
 * below 0 or above 100. Both tails are handled by the first/last band rather
 * than falling through to `undefined`.
 */

export interface FleschBand {
  /** Short label for the band, e.g. "Plain English". */
  label: string;
  /** US school grade level the text reads at, e.g. "8th–9th grade". */
  grade: string;
  /** `label` + `grade`, ready to render, e.g. "Plain English — 8th–9th grade". */
  summary: string;
  /** Rough difficulty direction, for tinting. Easier reading = better for most pages. */
  tone: 'ok' | 'neutral' | 'warn';
}

interface BandRow extends FleschBand {
  /** Inclusive lower bound. */
  min: number;
}

/** Standard Flesch Reading Ease bands, highest score (easiest) first. */
const BANDS: readonly BandRow[] = [
  {
    min: 90,
    label: 'Very easy',
    grade: '5th grade',
    summary: 'Very easy — 5th grade',
    tone: 'ok',
  },
  { min: 80, label: 'Easy', grade: '6th grade', summary: 'Easy — 6th grade', tone: 'ok' },
  {
    min: 70,
    label: 'Fairly easy',
    grade: '7th grade',
    summary: 'Fairly easy — 7th grade',
    tone: 'ok',
  },
  {
    min: 60,
    label: 'Plain English',
    grade: '8th–9th grade',
    summary: 'Plain English — 8th–9th grade',
    tone: 'ok',
  },
  {
    min: 50,
    label: 'Fairly difficult',
    grade: '10th–12th grade',
    summary: 'Fairly difficult — 10th–12th grade',
    tone: 'neutral',
  },
  {
    min: 30,
    label: 'Difficult',
    grade: 'College',
    summary: 'Difficult — college',
    tone: 'warn',
  },
  {
    min: 10,
    label: 'Very difficult',
    grade: 'College graduate',
    summary: 'Very difficult — college graduate',
    tone: 'warn',
  },
  {
    min: Number.NEGATIVE_INFINITY,
    label: 'Extremely difficult',
    grade: 'Professional',
    summary: 'Extremely difficult — professional',
    tone: 'warn',
  },
];

/**
 * @returns the standard band for a Flesch score, or `null` when there is no
 *   score. `null` in / `null` out — a page with no prose has no readability,
 *   and inventing a band for it would be a lie the UI then renders as fact.
 */
export function fleschBand(score: number | null | undefined): FleschBand | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  for (const b of BANDS) {
    if (score >= b.min) return { label: b.label, grade: b.grade, summary: b.summary, tone: b.tone };
  }
  // Unreachable — the last row's `min` is -Infinity — but typed exhaustively so
  // a future edit to BANDS can't silently start returning undefined.
  return null;
}
