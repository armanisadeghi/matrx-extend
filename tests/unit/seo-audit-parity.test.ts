/**
 * The extension's live-DOM SEO audit is a deliberate MIRROR of the canonical
 * server auditor (`matrx_scraper/seo_audit.py::audit_html`) — see the header of
 * `src/lib/seo/audit.ts` for why a second implementation is justified.
 *
 * These tests pin the counting rules that DIVERGED and silently produced
 * different numbers for the same page. Each one fails against the pre-2026-08-09
 * implementation. If you change a rule here, change the Python in the same unit
 * of work.
 */
import { runAudit } from '@/lib/seo/audit';
import { describe, expect, it } from 'vitest';

function audit(html: string, baseUrl = 'https://example.com/page') {
  const doc = new DOMParser().parseFromString(
    `<html lang="en"><head><base href="${baseUrl}"><title>T</title></head><body>${html}</body></html>`,
    'text/html',
  );
  // Explicit base URL — the same thing `runScrape` threads through for the
  // fetch-and-parse path, and the equivalent of the server's `base_url` arg.
  return runAudit(doc, baseUrl);
}

describe('seo audit — parity with matrx_scraper/seo_audit.py', () => {
  it('reports the explicit base URL, not the parsing document', () => {
    // A DOMParser Document has `location === null` in Chrome, so the
    // fetch-and-parse path MUST pass the resolved final URL through.
    expect(audit('<p>x</p>').url).toBe('https://example.com/page');
  });

  it('counts sentences as split-pieces, including the final one', () => {
    // `re.split(r"[.!?]+\s+", "One. Two. Three.")` -> ["One", "Two", "Three."]
    // The old delimiter-count returned 2 and skewed every Flesch score.
    expect(audit('<p>One. Two. Three.</p>').sentence_count).toBe(3);
  });

  it('scores prose with no trailing whitespace at all', () => {
    const a = audit('<p>The cat sat.</p>');
    expect(a.sentence_count).toBe(1);
    expect(a.flesch_reading_ease).not.toBeNull();
  });

  it('reports no score rather than a wrong one for an empty page', () => {
    const a = audit('');
    expect(a.word_count).toBe(0);
    expect(a.sentence_count).toBe(0);
    expect(a.flesch_reading_ease).toBeNull();
  });

  it('clamps a pathological score into the DB column range', () => {
    // One "sentence" of many long words drives the raw Flesch far below -999.99.
    const words = Array(400).fill('extraordinarily').join(' ');
    const score = audit(`<p>${words}</p>`).flesch_reading_ease;
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThanOrEqual(-999.99);
  });

  it('skips empty headings so they cannot eat the 200-heading cap', () => {
    const a = audit('<h1>Real</h1><h2></h2><h2>   </h2><h3>Also real</h3>');
    expect(a.headings).toEqual([
      { level: 1, text: 'Real' },
      { level: 3, text: 'Also real' },
    ]);
  });

  it('caps headings at 200 after the empty-skip, not before', () => {
    const html = Array(250)
      .fill(0)
      .map((_, i) => `<h2></h2><h2>H${i}</h2>`)
      .join('');
    const a = audit(html);
    expect(a.headings).toHaveLength(200);
    expect(a.headings[0]).toEqual({ level: 2, text: 'H0' });
  });

  it('ignores non-http(s) links instead of counting them as external', () => {
    // `new URL('javascript:void(0)')` parses fine with an empty host, so the
    // old try/catch-only guard inflated `external` on every JS-driven nav.
    const a = audit(
      [
        '<a href="/about">internal</a>',
        '<a href="https://example.com/deep">internal abs</a>',
        '<a href="https://other.test/x">external</a>',
        '<a href="javascript:void(0)">js</a>',
        '<a href="mailto:a@b.c">mail</a>',
        '<a href="tel:+15551234">tel</a>',
        '<a href="#frag">frag</a>',
      ].join(''),
    );
    expect(a.links).toEqual({ internal: 3, external: 1 });
  });

  it('counts a subdomain as external, matching the Python', () => {
    // Python tags it link_type="subdomain" but still does `external += 1`.
    const a = audit('<a href="https://blog.example.com/p">sub</a>');
    expect(a.links).toEqual({ internal: 0, external: 1 });
  });

  it('measures text on a non-rendered Document via the textContent fallback', () => {
    // happy-dom/DOMParser return '' for innerText on an unrendered doc, which
    // used to zero word_count for every fetch_url_as_markdown result.
    expect(audit('<p>alpha beta gamma</p>').word_count).toBe(3);
  });
});
