import { describe, expect, it } from 'vitest';
import { buildCapturePortions, portionsFromArticleHtml, portionsFromMarkdown } from './portions';

describe('portionsFromArticleHtml', () => {
  it('splits at H1–H3 and carries the heading path', () => {
    const html = `
      <p>Intro before any heading.</p>
      <h1>Guide</h1><p>Welcome   to the <b>guide</b>.</p>
      <h2>Install</h2><ul><li>Step one</li><li>Step two</li></ul>
      <h4>Not a split</h4><p>Still install.</p>
      <h3>Linux</h3><p>apt install it</p>
      <h2>Use</h2><p>Run it.</p><script>alert(1)</script>`;
    const portions = portionsFromArticleHtml(html);
    expect(portions.map((p) => p.locator.heading_path)).toEqual([
      [],
      ['Guide'],
      ['Guide', 'Install'],
      ['Guide', 'Install', 'Linux'],
      ['Guide', 'Use'],
    ]);
    expect(portions.map((p) => p.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(portions[1]?.text).toBe('Guide\nWelcome to the guide.');
    expect(portions[2]?.text).toBe('Install\nStep one\nStep two\nNot a split\nStill install.');
    expect(portions[4]?.text).not.toContain('alert');
    for (const p of portions) {
      expect(p.kind).toBe('section');
      expect(p.locator.text_fragment).toBe(p.text.replace(/\s+/g, ' ').slice(0, 80));
    }
  });

  it('a page with no headings is one section with an empty path', () => {
    const portions = portionsFromArticleHtml('<p>Just a paragraph.</p><p>And another.</p>');
    expect(portions).toHaveLength(1);
    expect(portions[0]?.locator.heading_path).toEqual([]);
    expect(portions[0]?.text).toBe('Just a paragraph.\nAnd another.');
  });

  it('clips the fragment to 80 characters', () => {
    const long = 'word '.repeat(60);
    const [p] = portionsFromArticleHtml(`<p>${long}</p>`);
    expect(p?.locator.text_fragment.length).toBe(80);
  });

  it('returns nothing for empty html', () => {
    expect(portionsFromArticleHtml('')).toEqual([]);
    expect(portionsFromArticleHtml('<p>   </p>')).toEqual([]);
  });
});

describe('portionsFromMarkdown', () => {
  it('splits at # to ### and never inside a fenced block', () => {
    const md = [
      'Lead paragraph.',
      '# Title',
      'Body.',
      '## Part A',
      '```',
      '# not a heading',
      '```',
      '#### deep stays',
      '### Detail ###',
      'x',
      '## Part B',
      'y',
    ].join('\n');
    const portions = portionsFromMarkdown(md);
    expect(portions.map((p) => p.locator.heading_path)).toEqual([
      [],
      ['Title'],
      ['Title', 'Part A'],
      ['Title', 'Part A', 'Detail'],
      ['Title', 'Part B'],
    ]);
    expect(portions[2]?.text).toContain('# not a heading');
    expect(portions[2]?.text).toContain('#### deep stays');
  });
});

describe('buildCapturePortions', () => {
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

  it('prefers the article html', () => {
    const r = buildCapturePortions(article('<h2>A</h2><p>x</p>', '# B\ny'));
    expect(r.from).toBe('article_html');
    expect(r.portions[0]?.locator.heading_path).toEqual(['A']);
  });

  it('falls back to markdown when the html has no text', () => {
    const r = buildCapturePortions(article('<div></div>', '# B\ny'));
    expect(r.from).toBe('article_markdown');
    expect(r.portions[0]?.locator.heading_path).toEqual(['B']);
  });

  it('says so when there is nothing at all', () => {
    expect(buildCapturePortions(article(null, null))).toEqual({ portions: [], from: null });
  });
});
