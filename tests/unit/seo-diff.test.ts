import {
  type StoredAuditSignals,
  diffSeoAudits,
  parseStoredSignals,
  summarizeDiff,
} from '@/lib/seo/diff';
import { describe, expect, it } from 'vitest';

function base(over: Partial<StoredAuditSignals> = {}): StoredAuditSignals {
  return {
    url: 'https://example.com/',
    title: { value: 'Widgets', length: 7 },
    description: { value: 'We sell widgets.', length: 16 },
    canonical: 'https://example.com/',
    robots: 'index,follow',
    schema_types: ['Organization'],
    headings: [
      { level: 1, text: 'Widgets' },
      { level: 2, text: 'Pricing' },
    ],
    links: { internal: 10, external: 3 },
    images: { total: 8, missing_alt: 5 },
    word_count: 1200,
    // Display-only fields (rendered, never diffed) — present so the fixture is
    // a real StoredAuditSignals, but nothing below should ever produce an entry.
    lang: 'en',
    hreflang: [],
    og: {},
    twitter: {},
    sentence_count: 60,
    flesch_reading_ease: 55.2,
    performance: null,
    ...over,
  };
}

const verdicts = (a: StoredAuditSignals, b: StoredAuditSignals) =>
  diffSeoAudits(a, b).entries.map((e) => e.verdict);

describe('diffSeoAudits', () => {
  it('reports identical audits as identical, with everything in unchanged', () => {
    const d = diffSeoAudits(base(), base());
    expect(d.identical).toBe(true);
    expect(d.entries).toEqual([]);
    expect(d.unchanged).toContain('Title');
    expect(d.unchanged).toContain('Missing alt text');
    expect(summarizeDiff(d)).toBe('No changes');
  });

  it('never lists an unchanged field as an entry', () => {
    const d = diffSeoAudits(base(), base({ word_count: 1400 }));
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]?.key).toBe('word_count');
    expect(d.unchanged).not.toContain('Word count');
    expect(summarizeDiff(d)).toBe('1 change');
  });

  it('states the missing-alt delta in words and calls a drop an improvement', () => {
    const d = diffSeoAudits(base(), base({ images: { total: 8, missing_alt: 2 } }));
    const alt = d.entries.find((e) => e.key === 'images_missing_alt');
    expect(alt?.verdict).toBe('3 fewer images missing alt text (5 → 2)');
    expect(alt?.direction).toBe('better');
  });

  it('calls out a clean sweep to zero missing alt text', () => {
    const d = diffSeoAudits(base(), base({ images: { total: 8, missing_alt: 0 } }));
    expect(d.entries.find((e) => e.key === 'images_missing_alt')?.verdict).toBe(
      'Every image now has alt text (was 5 missing)',
    );
  });

  it('marks new missing alt text as worse and singularizes correctly', () => {
    const d = diffSeoAudits(base(), base({ images: { total: 9, missing_alt: 6 } }));
    const alt = d.entries.find((e) => e.key === 'images_missing_alt');
    expect(alt?.verdict).toBe('1 more image missing alt text (5 → 6)');
    expect(alt?.direction).toBe('worse');
    expect(d.entries.find((e) => e.key === 'images_total')?.verdict).toBe(
      '1 more image on the page (8 → 9)',
    );
  });

  it('reports a title rewrite with both lengths and before/after', () => {
    const d = diffSeoAudits(
      base(),
      base({ title: { value: 'Widgets — Free shipping', length: 23 } }),
    );
    const t = d.entries.find((e) => e.key === 'title');
    expect(t?.verdict).toBe('Title rewritten (7 → 23 chars)');
    expect(t?.before).toBe('Widgets');
    expect(t?.after).toBe('Widgets — Free shipping');
  });

  it('distinguishes adding, removing, and rewriting a meta description', () => {
    const none = base({ description: { value: null, length: 0 } });
    expect(verdicts(none, base())).toContain('Meta description added (16 chars)');
    expect(verdicts(base(), none)).toContain('Meta description removed');
    expect(
      verdicts(base(), base({ description: { value: 'Buy widgets today.', length: 18 } })),
    ).toContain('Meta description rewritten (16 → 18 chars)');
    expect(diffSeoAudits(none, base()).entries[0]?.direction).toBe('better');
    expect(diffSeoAudits(base(), none).entries[0]?.direction).toBe('worse');
  });

  it('reports canonical and robots changes, including add/remove', () => {
    expect(verdicts(base(), base({ canonical: 'https://example.com/widgets' }))).toContain(
      'Canonical changed',
    );
    expect(verdicts(base({ canonical: null }), base())).toContain('Canonical tag added');
    expect(verdicts(base(), base({ robots: null }))).toContain('Robots tag removed');
    expect(verdicts(base(), base({ robots: 'noindex' }))).toContain('Robots changed');
  });

  it('counts headings added and removed and lists them', () => {
    const d = diffSeoAudits(
      base(),
      base({
        headings: [
          { level: 1, text: 'Widgets' },
          { level: 2, text: 'Plans' },
          { level: 2, text: 'FAQ' },
        ],
      }),
    );
    const h = d.entries.find((e) => e.key === 'headings');
    expect(h?.verdict).toBe('Headings: 2 added, 1 removed (2 → 3)');
    expect(h?.items).toEqual(['+ H2 Plans', '+ H2 FAQ', '− H2 Pricing']);
  });

  it('treats headings as a multiset — a duplicated heading is an addition', () => {
    const d = diffSeoAudits(
      base(),
      base({
        headings: [
          { level: 1, text: 'Widgets' },
          { level: 2, text: 'Pricing' },
          { level: 2, text: 'Pricing' },
        ],
      }),
    );
    expect(d.entries.find((e) => e.key === 'headings')?.items).toEqual(['+ H2 Pricing']);
  });

  it('reports link deltas per kind and skips the kind that did not move', () => {
    const d = diffSeoAudits(base(), base({ links: { internal: 14, external: 3 } }));
    expect(d.entries.find((e) => e.key === 'links_internal')?.verdict).toBe(
      '4 more internal links (10 → 14)',
    );
    expect(d.entries.find((e) => e.key === 'links_external')).toBeUndefined();
    expect(d.unchanged).toContain('External links');
  });

  it('reports gained and lost schema types with a direction', () => {
    const gained = diffSeoAudits(base(), base({ schema_types: ['Organization', 'FAQPage'] }));
    expect(gained.entries[0]?.verdict).toBe('Structured data gained FAQPage');
    expect(gained.entries[0]?.direction).toBe('better');

    const lost = diffSeoAudits(base(), base({ schema_types: [] }));
    expect(lost.entries[0]?.verdict).toBe('Structured data lost Organization');
    expect(lost.entries[0]?.direction).toBe('worse');

    const swapped = diffSeoAudits(base(), base({ schema_types: ['Product'] }));
    expect(swapped.entries[0]?.verdict).toBe('Structured data gained Product; lost Organization');
    expect(swapped.entries[0]?.direction).toBe('neutral');
  });

  it('formats large numbers with separators', () => {
    const d = diffSeoAudits(base({ word_count: 1200 }), base({ word_count: 3450 }));
    expect(d.entries[0]?.verdict).toBe('2,250 more words (1,200 → 3,450)');
  });

  it('skips a field entirely when one side never recorded it', () => {
    // An older saved row predates a field; it must not be reported as a change,
    // and it must not be claimed as "unchanged" either.
    const older = base({ links: null, schema_types: null });
    const d = diffSeoAudits(older, base());
    expect(d.entries.map((e) => e.key)).not.toContain('links_internal');
    expect(d.unchanged).not.toContain('Internal links');
    expect(d.unchanged).not.toContain('Structured data');
  });
});

describe('parseStoredSignals', () => {
  it('reads a full live-audit blob', () => {
    const parsed = parseStoredSignals({
      url: 'https://example.com/',
      title: { value: 'Hi', length: 2 },
      description: { value: null, length: 0 },
      canonical: null,
      robots: 'index',
      schema_types: ['Article'],
      headings: [{ level: 1, text: 'Hi' }],
      links: { internal: 2, external: 1 },
      images: { total: 1, missing_alt: 0 },
      word_count: 10,
      // fields the diff ignores must not break parsing
      og: { 'og:title': 'Hi' },
      performance: { nav_type: 'navigate' },
    });
    expect(parsed?.title).toEqual({ value: 'Hi', length: 2 });
    expect(parsed?.links).toEqual({ internal: 2, external: 1 });
    expect(parsed?.word_count).toBe(10);
  });

  it('returns null for a non-object blob and nulls absent sub-objects', () => {
    expect(parseStoredSignals(null)).toBeNull();
    expect(parseStoredSignals('nope')).toBeNull();
    expect(parseStoredSignals([])).toBeNull();
    const sparse = parseStoredSignals({ url: 'https://x.test/' });
    expect(sparse?.title).toBeNull();
    expect(sparse?.images).toBeNull();
    expect(sparse?.word_count).toBeNull();
  });

  it('drops malformed heading entries instead of failing the whole row', () => {
    const parsed = parseStoredSignals({
      headings: [{ level: 1, text: 'ok' }, { level: 'two', text: 'bad' }, null, { text: 'no lvl' }],
    });
    expect(parsed?.headings).toEqual([{ level: 1, text: 'ok' }]);
  });

  it('derives a missing length from the value', () => {
    const parsed = parseStoredSignals({ title: { value: 'four' } });
    expect(parsed?.title).toEqual({ value: 'four', length: 4 });
  });
});
