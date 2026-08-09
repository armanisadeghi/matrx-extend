/**
 * Publish / modify dates must survive the whole path: page DOM → collectMetadata
 * → ExtensionStructuredPayload → the submitted request body.
 *
 * The server (aidream `research/multisource.py` `_structured_dates`) reads
 * `metadata.published_time` / `metadata.modified_time` FIRST and only falls back
 * to JSON-LD. Before this, the extension sent neither — `article:published_time`
 * is a `property=` meta that doesn't start with `og:`, so the collector dropped
 * it and OG-only pages stored no dates at all. See docs/feature-tests.md
 * "Research capture — publish dates".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiPost } from '@/lib/api/client';
import { submitExtensionContent } from '@/lib/api/routes/research';
import {
  MODIFIED_TIME_SELECTORS,
  PUBLISHED_TIME_SELECTORS,
  collectMetadata,
  normalizeIsoDate,
} from '@/lib/scrape/collectors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(async () => ({ ok: true as const, data: {} })),
}));

const parse = (html: string): Document =>
  new DOMParser().parseFromString(`<html><head>${html}</head><body></body></html>`, 'text/html');

const FIXTURE = `
  <title>The Article</title>
  <meta name="description" content="A page with OG article dates and no JSON-LD.">
  <meta property="og:title" content="The Article">
  <meta property="article:published_time" content="2026-08-01T09:30:00Z">
  <meta property="article:modified_time" content="2026-08-07T14:05:00+02:00">
`;

describe('normalizeIsoDate', () => {
  it('keeps unambiguous ISO values verbatim (offset preserved)', () => {
    expect(normalizeIsoDate('2026-08-01T09:30:00Z')).toBe('2026-08-01T09:30:00Z');
    expect(normalizeIsoDate('2026-08-07T14:05:00+02:00')).toBe('2026-08-07T14:05:00+02:00');
    expect(normalizeIsoDate('  2026-08-01  ')).toBe('2026-08-01');
  });

  it('drops anything ambiguous or impossible rather than guessing', () => {
    for (const bad of [
      '08/09/2026',
      'August 9, 2026',
      '2026',
      'yesterday',
      '2026-13-45',
      '',
      null,
      undefined,
    ]) {
      expect(normalizeIsoDate(bad), String(bad)).toBeNull();
    }
  });
});

describe('collectMetadata dates', () => {
  it('reads article:published_time / article:modified_time', () => {
    const meta = collectMetadata(parse(FIXTURE));
    expect(meta.published_time).toBe('2026-08-01T09:30:00Z');
    expect(meta.modified_time).toBe('2026-08-07T14:05:00+02:00');
  });

  it('falls back through the alias selectors in order', () => {
    const meta = collectMetadata(
      parse(`
        <meta itemprop="datePublished" content="2026-01-02T03:04:05Z">
        <meta property="og:updated_time" content="2026-02-03">
      `),
    );
    expect(meta.published_time).toBe('2026-01-02T03:04:05Z');
    expect(meta.modified_time).toBe('2026-02-03');
  });

  it('is null (not a guess) when the page only has a locale-formatted date', () => {
    const meta = collectMetadata(parse('<meta name="date" content="August 9, 2026">'));
    expect(meta.published_time).toBeNull();
    expect(meta.modified_time).toBeNull();
  });
});

describe('capture-media.ts inline mirror', () => {
  // The injected func runs in the page world and cannot import collectors.ts,
  // so the logic is duplicated by necessity. This is the only thing stopping
  // the two copies from silently drifting.
  const source = readFileSync(resolve(__dirname, '../../src/lib/scrape/capture-media.ts'), 'utf8');

  it('collects the same selectors as collectors.ts', () => {
    for (const [selector, attr] of [...PUBLISHED_TIME_SELECTORS, ...MODIFIED_TIME_SELECTORS]) {
      expect(source, selector).toContain(`['${selector}', '${attr}']`);
    }
  });

  it('assigns both keys onto the metadata it returns', () => {
    expect(source).toContain('published_time: publishedTime');
    expect(source).toContain('modified_time: modifiedTime');
  });
});

describe('submitExtensionContent wire payload', () => {
  beforeEach(() => vi.mocked(apiPost).mockClear());

  it('carries the collected dates under the exact keys the server reads', async () => {
    const metadata = collectMetadata(parse(FIXTURE));
    await submitExtensionContent('topic-1', 'source-1', '<html></html>', 2, [], {
      structured: { metadata, jsonLd: [] },
    });

    const [, body] = vi.mocked(apiPost).mock.calls[0] as [string, Record<string, unknown>];
    const structured = body.structured as { metadata: Record<string, unknown> };
    expect(structured.metadata.published_time).toBe('2026-08-01T09:30:00Z');
    expect(structured.metadata.modified_time).toBe('2026-08-07T14:05:00+02:00');
  });
});
