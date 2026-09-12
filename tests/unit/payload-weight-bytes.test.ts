/**
 * Payload weights are UTF-8 BYTES, measured in the page (2026-09-12).
 *
 * The Framework probe (`next-data.ts`) and the page diagnostic both stored a
 * string's `.length` — UTF-16 code units — in fields that reach
 * `formatFileSize` ("__NEXT_DATA__ (12.7 KB)", Doctor tab `size_bytes`). On an
 * ASCII page the two agree, which is why nothing noticed; on a Japanese page
 * the real payload is ~3x larger. These tests run the REAL `func:` bodies in a
 * DOM with a non-ASCII payload, so a regression to `.length` fails here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { nextDataMode } from '../../src/lib/data-pattern/modes/next-data';
import { pageDiagnosticInPage } from '../../src/lib/data-pattern/page-diagnostic';

const JAPANESE = JSON.stringify({ props: { text: '日本語'.repeat(400).slice(0, 1000) } });
const utf8 = (s: string) => new TextEncoder().encode(s).length;

function mountScript(id: string, text: string) {
  const s = document.createElement('script');
  s.id = id;
  s.type = 'application/json';
  s.textContent = text;
  document.body.appendChild(s);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('payload weights are bytes, not UTF-16 code units', () => {
  it('the premise: this payload has far more bytes than characters', () => {
    expect(utf8(JAPANESE)).toBeGreaterThan(JAPANESE.length * 2);
  });

  it('next-data detectInPage reports sizeBytes = UTF-8 bytes, and summarize renders them', () => {
    mountScript('__NEXT_DATA__', JAPANESE);
    const hint = (
      nextDataMode.detectInPage as () => {
        meta?: { sources?: Array<Record<string, unknown>> };
      }
    )();
    const source = hint.meta?.sources?.[0];
    expect(source?.sizeBytes).toBe(utf8(JAPANESE));
    expect(source).not.toHaveProperty('size');
    expect(nextDataMode.summarize?.(hint as never)).toBe('__NEXT_DATA__ (3.0 KB)');
  });

  it('next-data window.* assignment weight is the UTF-8 bytes of the literal itself', () => {
    const literal = JSON.stringify({ q: 'é'.repeat(500) });
    const script = document.createElement('script');
    script.textContent = `window.__INITIAL_STATE__ = ${literal};`;
    document.body.appendChild(script);
    const hint = (
      nextDataMode.detectInPage as () => {
        meta?: { sources?: Array<Record<string, unknown>> };
      }
    )();
    const entry = hint.meta?.sources?.find((s) => s.source === 'window.__INITIAL_STATE__');
    expect(entry?.sizeBytes).toBe(utf8(literal));
  });

  it('page diagnostic *_bytes fields are UTF-8 bytes', () => {
    mountScript('__NEXT_DATA__', JAPANESE);
    const diag = pageDiagnosticInPage();
    expect(diag.sources.next_data.size_bytes).toBe(utf8(JAPANESE));
    expect(diag.recommendations.find((r) => r.mode === 'next_data')?.size_bytes).toBe(
      utf8(JAPANESE),
    );
  });
});
