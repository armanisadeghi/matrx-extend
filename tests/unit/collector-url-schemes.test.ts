/**
 * `new URL()` throws only on values it cannot parse AT ALL. `javascript:void(0)`,
 * `mailto:`, `tel:` and `blob:` all parse fine — they just have an empty host —
 * so the old try/catch-only `abs()` helper let every one of them into
 * `collectLinks`' output, which becomes the `page_links` context key, and
 * `SoupResult.links` → the research capture sink's `extracted_links`. An agent
 * handed `javascript:void(0)` as a link tries to navigate to it.
 *
 * The link rule now mirrors the canonical server auditor exactly, from the link
 * loop in `aidream/packages/matrx-scraper/matrx_scraper/seo_audit.py`:
 *   `if not host or not u.startswith(("http://", "https://")): continue`
 *
 * The media collectors deliberately keep a WIDER rule — `data:`/`blob:` are real
 * image/video sources — and cut only never-fetchable schemes.
 *
 * See docs/feature-tests.md "Scrape — link scheme filtering".
 */

import { collectAudio, collectImages, collectLinks, collectVideos } from '@/lib/scrape/collectors';
import { describe, expect, it } from 'vitest';

/**
 * Use the environment's real document: `collectLinks` reads `a.href`, the IDL
 * attribute the DOM has already resolved against the document's own location,
 * so a detached DOMParser document would not exercise relative resolution.
 */
const docWithBody = (body: string): Document => {
  document.body.innerHTML = body;
  return document;
};

/** Same base the DOM resolves against, so expectations aren't host-hardcoded. */
const from = (raw: string): string => new URL(raw, document.baseURI).toString();

describe('collectLinks — only navigable http(s) links survive', () => {
  const doc = docWithBody(`
    <a href="http://plain.example.org/a">plain http</a>
    <a href="https://secure.example.org/b">https</a>
    <a href="//cdn.example.org/c">protocol-relative</a>
    <a href="/about">root-relative</a>
    <a href="#section">same-page fragment</a>
    <a href="javascript:void(0)">JS nav</a>
    <a href="JavaScript:doThing()">JS nav, mixed case</a>
    <a href="mailto:someone@example.org">email us</a>
    <a href="tel:+15555550123">call us</a>
    <a href="blob:https://example.com/8f2c-uuid">blob</a>
    <a href="data:text/html,<b>x</b>">data</a>
  `);

  const hrefs = collectLinks(doc).map((l) => l.href);

  it('keeps exactly the http(s)-with-a-host set', () => {
    expect(hrefs.sort()).toEqual(
      [
        'http://plain.example.org/a',
        'https://secure.example.org/b',
        from('//cdn.example.org/c'),
        from('/about'),
        from('#section'),
      ].sort(),
    );
  });

  it('drops every pseudo-scheme that `new URL()` happily parses', () => {
    for (const junk of ['javascript:', 'mailto:', 'tel:', 'blob:', 'data:']) {
      expect(hrefs.some((h) => h.toLowerCase().startsWith(junk))).toBe(false);
    }
  });

  it('keeps a same-page #fragment — it resolves to a real http(s) target', () => {
    // Mirrors the server's `urljoin(base, '#section')`, which also survives.
    expect(hrefs).toContain(from('#section'));
  });
});

describe('media collectors — data:/blob: are legitimate sources and are kept', () => {
  it('collectImages keeps data: and blob:, drops javascript:', () => {
    const doc = docWithBody(`
      <img src="https://cdn.example.org/real.png" alt="real">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="inline">
      <img src="blob:https://example.com/8f2c-uuid" alt="canvas export">
      <img src="javascript:void(0)" alt="junk">
    `);
    const srcs = collectImages(doc).map((i) => i.src);
    expect(srcs).toContain('https://cdn.example.org/real.png');
    expect(srcs.some((s) => s.startsWith('data:'))).toBe(true);
    expect(srcs.some((s) => s.startsWith('blob:'))).toBe(true);
    expect(srcs.some((s) => s.toLowerCase().startsWith('javascript:'))).toBe(false);
  });

  it('collectVideos and collectAudio keep blob: (MediaSource playback)', () => {
    const doc = docWithBody(`
      <video src="blob:https://example.com/video-uuid"></video>
      <audio src="blob:https://example.com/audio-uuid"></audio>
    `);
    expect(collectVideos(doc).map((v) => v.src)).toContain('blob:https://example.com/video-uuid');
    expect(collectAudio(doc).map((a) => a.src)).toContain('blob:https://example.com/audio-uuid');
  });
});
