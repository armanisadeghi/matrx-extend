/**
 * The SEO audit's DISPLAY layer — the half that had gone silently missing.
 *
 * `runAudit` collected hreflang, og, twitter, schema_types, lang, the
 * internal/external link counts, sentence_count, flesch_reading_ease and the
 * performance block; persisted all of it to `extend.wbx_seo_audit`; shipped it
 * into agent context — and then the SEO tab rendered roughly a third of it and
 * `seoAuditToText` copied even less. These tests pin the three pure pieces of
 * the fix so it cannot quietly regress:
 *
 *   1. `fleschBand` — the standard Flesch bands, so a raw score is readable.
 *   2. `isOpenableUrl` / `schemaTypeUrl` — the door test behind <OpenUrl>.
 *   3. `seoAuditToText` — Copy / "For AI agent" must carry every field.
 *
 * The component itself is not covered here: this repo has no React testing
 * library and vitest only collects `.ts`. Manual paths are in
 * docs/feature-tests.md → "SEO audit — every collected field is visible".
 */

import type { StoredAuditSignals } from '@/lib/seo/diff';
import { fleschBand } from '@/lib/seo/flesch-bands';
import { seoAuditToText } from '@/lib/seo/to-text';
import { isOpenableUrl, schemaTypeUrl } from '@/lib/url/openable';
import { describe, expect, it } from 'vitest';

function signals(over: Partial<StoredAuditSignals> = {}): StoredAuditSignals {
  return {
    url: 'https://example.com/',
    title: { value: 'Widgets', length: 7 },
    description: { value: 'We sell widgets.', length: 16 },
    canonical: 'https://example.com/',
    robots: 'index,follow',
    schema_types: [],
    headings: [],
    links: null,
    images: null,
    word_count: 0,
    lang: null,
    hreflang: [],
    og: {},
    twitter: {},
    sentence_count: null,
    flesch_reading_ease: null,
    performance: null,
    ...over,
  };
}

describe('fleschBand — the standard Flesch table', () => {
  // Boundaries are the whole point: the bands are inclusive-low, so a score of
  // exactly 60 must be "Plain English", not "Fairly difficult".
  it.each([
    [100, 'Very easy', '5th grade'],
    [90, 'Very easy', '5th grade'],
    [89.9, 'Easy', '6th grade'],
    [80, 'Easy', '6th grade'],
    [70, 'Fairly easy', '7th grade'],
    [69.9, 'Plain English', '8th–9th grade'],
    [60, 'Plain English', '8th–9th grade'],
    [59.9, 'Fairly difficult', '10th–12th grade'],
    [50, 'Fairly difficult', '10th–12th grade'],
    [30, 'Difficult', 'College'],
    [10, 'Very difficult', 'College graduate'],
    [9.9, 'Extremely difficult', 'Professional'],
    [0, 'Extremely difficult', 'Professional'],
  ])('scores %s as "%s" (%s)', (score, label, grade) => {
    const b = fleschBand(score);
    expect(b?.label).toBe(label);
    expect(b?.grade).toBe(grade);
    expect(b?.summary).toBe(`${label} — ${grade.toLowerCase()}`);
  });

  it('handles the out-of-0-100 tails that audit.ts deliberately allows', () => {
    // audit.ts clamps to ±999.99, not to 0–100 — a single 4,000-word
    // "sentence" scores far below zero and must still land in a band.
    expect(fleschBand(-999.99)?.label).toBe('Extremely difficult');
    expect(fleschBand(999.99)?.label).toBe('Very easy');
  });

  it('returns null for no score rather than inventing a band', () => {
    // A page with no prose has no readability. Guessing here would put a
    // confident, wrong grade level on screen.
    expect(fleschBand(null)).toBeNull();
    expect(fleschBand(undefined)).toBeNull();
    expect(fleschBand(Number.NaN)).toBeNull();
  });

  it('treats a genuine score of 0 as a score, not as absent', () => {
    // Same class of bug audit.ts fixed with its `flesch ? …` null guard.
    expect(fleschBand(0)).not.toBeNull();
  });
});

describe('isOpenableUrl — never dress a non-URL as a link', () => {
  it('accepts http and https', () => {
    expect(isOpenableUrl('https://example.com/a?b=c#d')).toBe(true);
    expect(isOpenableUrl('http://example.com')).toBe(true);
  });

  it('rejects the schemes a page can smuggle into href/meta content', () => {
    // `new URL('javascript:void(0)')` PARSES — only the protocol check catches
    // it. Same trap the audit's link classifier had to fix.
    expect(isOpenableUrl('javascript:void(0)')).toBe(false);
    expect(isOpenableUrl('data:text/html,<h1>hi</h1>')).toBe(false);
    expect(isOpenableUrl('mailto:a@b.com')).toBe(false);
    expect(isOpenableUrl('tel:+15551234')).toBe(false);
  });

  it('rejects relative paths, fragments and empties', () => {
    expect(isOpenableUrl('/about')).toBe(false);
    expect(isOpenableUrl('#top')).toBe(false);
    expect(isOpenableUrl('')).toBe(false);
    expect(isOpenableUrl('   ')).toBe(false);
    expect(isOpenableUrl(null)).toBe(false);
    expect(isOpenableUrl(undefined)).toBe(false);
  });
});

describe('schemaTypeUrl — a schema type is a door', () => {
  it('sends a bare JSON-LD @type to its schema.org docs', () => {
    expect(schemaTypeUrl('Product')).toBe('https://schema.org/Product');
    expect(schemaTypeUrl('BreadcrumbList')).toBe('https://schema.org/BreadcrumbList');
  });

  it('passes a microdata itemtype URL through unchanged', () => {
    expect(schemaTypeUrl('https://schema.org/Recipe')).toBe('https://schema.org/Recipe');
    expect(schemaTypeUrl('http://schema.org/Person')).toBe('http://schema.org/Person');
  });

  it('returns null for values it cannot resolve, so the chip stays plain', () => {
    expect(schemaTypeUrl('')).toBeNull();
    expect(schemaTypeUrl('some vocabulary/Thing')).toBeNull();
    expect(schemaTypeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('seoAuditToText — Copy must carry everything collected', () => {
  it('includes every field that used to be silently dropped', () => {
    const text = seoAuditToText(
      signals({
        lang: 'en-US',
        hreflang: [
          { lang: 'fr', href: 'https://example.com/fr' },
          { lang: 'x-default', href: 'https://example.com/' },
        ],
        og: { 'og:title': 'Widgets', 'og:image': 'https://example.com/card.png' },
        twitter: { 'twitter:card': 'summary_large_image' },
        schema_types: ['Organization', 'Product'],
        links: { internal: 42, external: 7 },
        word_count: 1200,
        sentence_count: 60,
        flesch_reading_ease: 64.2,
        performance: {
          nav_type: 'navigate',
          duration_ms: 812,
          transfer_size_bytes: 152_000,
          http_status: 200,
          redirect_count: 1,
        },
      }),
    );

    expect(text).toContain('Page language: en-US');
    expect(text).toContain('fr: https://example.com/fr');
    expect(text).toContain('x-default: https://example.com/');
    expect(text).toContain('og:title: Widgets');
    expect(text).toContain('og:image: https://example.com/card.png');
    expect(text).toContain('twitter:card: summary_large_image');
    expect(text).toContain('Structured data (2): Organization, Product');
    expect(text).toContain('Internal links: 42');
    expect(text).toContain('External links: 7');
    expect(text).toContain('Sentences: 60');
    expect(text).toContain('HTTP status: 200');
    expect(text).toContain('Navigation type: navigate');
    expect(text).toContain('Redirect hops: 1');
    expect(text).toContain('Load duration: 812 ms');
    expect(text).toContain('Transfer size: 152000 bytes');
  });

  it('spells out the Flesch band, not just the raw number', () => {
    const text = seoAuditToText(signals({ flesch_reading_ease: 64.2, word_count: 900 }));
    expect(text).toContain('Flesch reading ease: 64.2 (Plain English — 8th–9th grade)');
  });

  it('omits empty groups instead of printing zeros or dashes', () => {
    // The UI rule, enforced on the copy path: a page with no social tags must
    // produce text an agent reads as "we found none", never as "there is a
    // social section that is empty".
    const text = seoAuditToText(signals());
    expect(text).not.toContain('Social preview tags');
    expect(text).not.toContain('International');
    expect(text).not.toContain('Structured data');
    expect(text).not.toContain('Performance');
    expect(text).not.toContain('Flesch');
    // …but the always-present header block is still there.
    expect(text).toContain('URL: https://example.com/');
    expect(text).toContain('Title (7 chars): Widgets');
  });

  it('omits a performance block whose every field is null', () => {
    const text = seoAuditToText(
      signals({
        performance: {
          nav_type: null,
          duration_ms: null,
          transfer_size_bytes: null,
          http_status: null,
          redirect_count: null,
        },
      }),
    );
    expect(text).not.toContain('Performance:');
  });
});
