import { afterEach, describe, expect, it } from 'vitest';
import {
  candidateMarkdownUrls,
  contentNegotiationUrl,
  detectMarkdownSignalsInPage,
  looksLikeMarkdown,
} from './markdown-source';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('candidateMarkdownUrls', () => {
  const noSignals = { alt_href: null, affordance_href: null, has_affordance: false };

  it('offers a sibling .md for an extensionless docs URL', () => {
    const urls = candidateMarkdownUrls(
      'https://ai.google.dev/gemini-api/docs/deprecations',
      noSignals,
    );
    expect(urls).toContain('https://ai.google.dev/gemini-api/docs/deprecations.md');
    // Docs platforms that serve Markdown as plain text use `<page>.md.txt`.
    expect(urls).toContain('https://ai.google.dev/gemini-api/docs/deprecations.md.txt');
    // llms.txt fallbacks at the site root.
    expect(urls).toContain('https://ai.google.dev/llms-full.txt');
    expect(urls).toContain('https://ai.google.dev/llms.txt');
  });

  it('handles a trailing-slash directory URL with index.md', () => {
    const urls = candidateMarkdownUrls('https://example.com/docs/', noSignals);
    expect(urls).toContain('https://example.com/docs/index.md');
    expect(urls).toContain('https://example.com/docs.md');
  });

  it('puts a declared alternate href first', () => {
    const urls = candidateMarkdownUrls('https://example.com/page', {
      alt_href: 'https://example.com/page.md',
      affordance_href: null,
      has_affordance: false,
    });
    expect(urls[0]).toBe('https://example.com/page.md');
  });

  it('does not guess a .md for a URL that already has a file extension', () => {
    const urls = candidateMarkdownUrls('https://example.com/data.json', noSignals);
    expect(urls.some((u) => u.endsWith('.json.md'))).toBe(false);
  });
});

describe('looksLikeMarkdown', () => {
  it('trusts a text/markdown content-type', () => {
    expect(looksLikeMarkdown('anything at all', 'text/markdown; charset=utf-8')).toBe(true);
  });

  it('rejects an HTML document even with a 200', () => {
    expect(looksLikeMarkdown('<!DOCTYPE html><html><body>x</body></html>', 'text/html')).toBe(
      false,
    );
    expect(looksLikeMarkdown('<html>...', null)).toBe(false);
  });

  it('accepts text/plain that is structurally Markdown', () => {
    const md = '# Title\n\n- one\n- two\n\n[link](https://x.com)\n';
    expect(looksLikeMarkdown(md, 'text/plain')).toBe(true);
  });

  it('rejects plain prose that is not Markdown', () => {
    expect(looksLikeMarkdown('Just a sentence with no structure.', 'text/plain')).toBe(false);
  });
});

describe('detectMarkdownSignalsInPage', () => {
  it('finds a declared text/markdown alternate link', () => {
    document.head.innerHTML = '<link rel="alternate" type="text/markdown" href="/page.md">';
    const s = detectMarkdownSignalsInPage();
    expect(s.alt_href).toContain('/page.md');
  });

  it('finds an on-page "view as Markdown" affordance', () => {
    document.body.innerHTML = '<a href="/x.md">Copy page as Markdown</a>';
    const s = detectMarkdownSignalsInPage();
    expect(s.has_affordance).toBe(true);
    expect(s.affordance_href).toContain('/x.md');
  });

  it('reports no signals on an ordinary page', () => {
    document.body.innerHTML = '<a href="/about">About</a>';
    const s = detectMarkdownSignalsInPage();
    expect(s.alt_href).toBeNull();
    expect(s.has_affordance).toBe(false);
  });
});

describe('contentNegotiationUrl', () => {
  it('returns http(s) URLs and rejects others', () => {
    expect(contentNegotiationUrl('https://x.com/a')).toBe('https://x.com/a');
    expect(contentNegotiationUrl('chrome://x')).toBeNull();
  });
});
