import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script, no declaration file
import { SERVER_DIR, portionFixtureDrift } from '../../../scripts/sync-portion-fixtures.mjs';
import { canonicalUrl } from './canonical';
import { buildCapturePortions, portionsFromArticleHtml, portionsFromMarkdown } from './portions';

// Expected outputs are the SERVER's (aidream matrx_scraper portioner — the single
// truth — on real pages), copied byte-for-byte under tests/fixtures/portions by
// scripts/sync-portion-fixtures.mjs. Never hand-edit an expected value here.
const DIR = resolve(__dirname, '../../../tests/fixtures/portions');
interface Fixture {
  name: string;
  url: string;
  html: string;
  markdown: string;
  canonical_url: string;
  html_portions: unknown[];
  markdown_portions: unknown[];
}
const fixtures: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')) as Fixture);

describe("the copied fixtures are the server's, byte for byte", () => {
  // Without the sibling aidream checkout (a clean CI box) this is reported as
  // skipped by name — the copies are still exercised below.
  it.skipIf(!existsSync(SERVER_DIR))(`no drift from ${SERVER_DIR}`, () => {
    expect(portionFixtureDrift().drift).toEqual([]);
  });
});

describe('portioner matches the server fixtures', () => {
  it('has the three pinned pages', () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual([
      'example_com',
      'python_org_tracking',
      'wikipedia_http',
    ]);
  });

  describe.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fx) => {
    it('HTML path', () => {
      expect(portionsFromArticleHtml(fx.html)).toEqual(fx.html_portions);
    });
    it('markdown path', () => {
      expect(portionsFromMarkdown(fx.markdown)).toEqual(fx.markdown_portions);
    });
    it('canonical identity', () => {
      expect(canonicalUrl(fx.url)).toBe(fx.canonical_url);
    });
  });
});

describe('buildCapturePortions — which field it cuts from', () => {
  const article = (html: string | null, md: string | null) => ({
    article: {
      title: null,
      byline: null,
      content_html_safe: html,
      content_markdown: md,
      excerpt: null,
      extractor: 'defuddle' as const,
      word_count: null,
      reading_time_minutes: null,
    },
  });
  const fx = fixtures.find((f) => f.name === 'example_com') as Fixture;

  it('prefers the article html', () => {
    const r = buildCapturePortions(article(fx.html, fx.markdown));
    expect(r.from).toBe('article_html');
    expect(r.portions).toEqual(fx.html_portions);
  });

  it('falls back to markdown when the html has no text', () => {
    const r = buildCapturePortions(article('<div></div>', fx.markdown));
    expect(r.from).toBe('article_markdown');
    expect(r.portions).toEqual(fx.markdown_portions);
  });

  it('says so when there is nothing at all', () => {
    expect(buildCapturePortions(article(null, null))).toEqual({ portions: [], from: null });
  });
});
