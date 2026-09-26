import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalUrl } from './canonical';

// Outputs captured from the SERVER's canonicalizer (matrx_scraper.canonical).
// A lookup keyed differently from the door's identity misses every capture.
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../tests/fixtures/canonical-url.server.json'), 'utf8'),
) as { cases: [string, string][] };

describe('canonicalUrl matches the landing door', () => {
  it.each(fixture.cases)('%j → %j', (input, expected) => {
    expect(canonicalUrl(input)).toBe(expected);
  });
});
