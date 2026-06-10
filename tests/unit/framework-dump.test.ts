/**
 * Tests for the framework-state scanner (audit P1-5 — previously a 140-line
 * inline closure in FrameworkTab with no coverage). Runs the REAL in-page
 * function against happy-dom documents.
 */

import { frameworkDumpInPage } from '@/lib/data-pattern/framework-dump';
import { beforeEach, describe, expect, it } from 'vitest';

function addScript(content: string, attrs: Record<string, string> = {}): void {
  const s = document.createElement('script');
  // happy-dom EXECUTES plain script tags on append (a real page would have
  // run them long before our scanner reads textContent). A non-JS type keeps
  // the element inert while still matching `script:not([src])`.
  s.setAttribute('type', 'text/plain');
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  s.textContent = content;
  document.body.appendChild(s);
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('frameworkDumpInPage', () => {
  it('reads __NEXT_DATA__ script tags', () => {
    addScript(JSON.stringify({ props: { pageProps: { id: 7 } } }), {
      id: '__NEXT_DATA__',
      type: 'application/json',
    });
    const out = frameworkDumpInPage();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: '__NEXT_DATA__' });
    expect((out[0]?.data as { props: { pageProps: { id: number } } }).props.pageProps.id).toBe(7);
  });

  it('skips malformed JSON in known script tags without throwing', () => {
    addScript('{not valid json', { id: '__NEXT_DATA__' });
    expect(frameworkDumpInPage()).toEqual([]);
  });

  it('extracts window.* JSON assignments via the paren-balanced scan', () => {
    addScript('window.__INITIAL_STATE__ = {"user":{"name":"Ada"},"items":[1,2]};');
    const out = frameworkDumpInPage();
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe('window.__INITIAL_STATE__');
    expect(out[0]?.data).toEqual({ user: { name: 'Ada' }, items: [1, 2] });
  });

  it('handles braces inside string values during the scan', () => {
    addScript('window.__INITIAL_DATA__ = {"text":"a } tricky { string","n":1};');
    const out = frameworkDumpInPage();
    expect(out[0]?.data).toEqual({ text: 'a } tricky { string', n: 1 });
  });

  it('falls back to safe-eval for JS object literals (unquoted keys)', () => {
    addScript("window._initialData = {jobs: [{title: 'Engineer'}], total: 1};");
    const out = frameworkDumpInPage();
    expect(out).toHaveLength(1);
    expect(out[0]?.data).toEqual({ jobs: [{ title: 'Engineer' }], total: 1 });
  });

  it('refuses blobs containing function/fetch/eval markers', () => {
    addScript('window.__APP_STATE__ = {run: function() { return 1; }};');
    expect(frameworkDumpInPage()).toEqual([]);
  });

  it('skips unbalanced blobs instead of hanging or mis-slicing', () => {
    addScript('window.__REDUX_STATE__ = {"a": 1');
    expect(frameworkDumpInPage()).toEqual([]);
  });

  it('aggregates LinkedIn bpr-guid blocks with included[] concat', () => {
    for (const [id, included] of [
      ['bpr-guid-1', [{ t: 'a' }]],
      ['bpr-guid-2', [{ t: 'b' }, { t: 'c' }]],
    ] as const) {
      const code = document.createElement('code');
      code.id = id;
      code.textContent = JSON.stringify({ included });
      document.body.appendChild(code);
    }
    const out = frameworkDumpInPage();
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe('bpr-guid');
    expect((out[0]?.data as { included: unknown[] }).included).toHaveLength(3);
  });

  it('surfaces BOTH the apollo script tag and a window.__APOLLO_STATE__ assignment', () => {
    addScript(JSON.stringify({ fromTag: true }), { id: '__APOLLO_STATE__' });
    addScript('window.__APOLLO_STATE__ = {"fromWindow": true};');
    const out = frameworkDumpInPage();
    const sources = out.map((o) => o.source);
    // They can genuinely differ — the source picker disambiguates (audit G2).
    expect(sources).toContain('apollo');
    expect(sources).toContain('window.__APOLLO_STATE__');
  });

  it('returns [] on a page with nothing', () => {
    expect(frameworkDumpInPage()).toEqual([]);
  });
});
