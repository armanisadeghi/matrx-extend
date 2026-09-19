/**
 * THE ONE DOOR, enforced by reading the repo (campaign lane `W6-EXT`, contract
 * row CUT-N-11: "never a second door, never raw table access").
 *
 * The record store is reached through `@ai-matrx/records/core` and nothing
 * else. That package calls the store's own doors, and the store holds the line
 * in the database — `authenticated` has no INSERT, UPDATE or DELETE grant on
 * `custom.record` — so a second path here would be REFUSED rather than
 * dangerous. It would still be a defect: a client that TRIES is the thing this
 * row forbids, and the try is what a reviewer reads as "the extension writes
 * records two ways".
 *
 * This test is the census, not the instance. It scans every source file in the
 * repo for two shapes:
 *   1. any reach into the `custom` schema that is not the package, and
 *   2. any import of a store door name by hand.
 *
 * PROVEN FAILING: written against a deliberate `supabase.schema('custom')
 * .from('record')` in src/lib/records/store.ts, this test failed with
 * "src/lib/records/store.ts reaches the record store outside
 * @ai-matrx/records"; with the line removed it passes. Re-prove it the same way
 * if you change the patterns.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..');
const SOURCE_DIRS = ['src', 'scripts'];
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.cjs'];

/** The only file allowed to BUILD a client — everything else imports from it. */
const THE_SEAM = 'src/lib/records/store.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
    }
  };
  walk(join(REPO, dir));
  return out;
}

describe('the record store has exactly one door in this repo', () => {
  const files = SOURCE_DIRS.flatMap(sourceFiles);

  it('scans a real, non-empty set of source files', () => {
    // A guard that silently scanned nothing would be green forever.
    expect(files.length).toBeGreaterThan(200);
  });

  it('nothing reaches the `custom` schema except @ai-matrx/records', () => {
    const offenders: string[] = [];
    for (const file of files) {
      // No file is exempt from this one, INCLUDING the seam: the seam is
      // exactly where a second door would be added first.
      const rel = relative(REPO, file);
      const text = readFileSync(file, 'utf8');
      if (/\.schema\(\s*['"]custom['"]\s*\)/.test(text)) {
        offenders.push(`${rel} reaches the record store outside @ai-matrx/records`);
      }
      if (/['"]custom\.[a-z_]+['"]/.test(text) && !text.includes('@ai-matrx/records')) {
        offenders.push(`${rel} names a store door by hand`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the seam is the only place that builds a records client', () => {
    const builders = files.filter((file) => {
      const rel = relative(REPO, file);
      if (rel === THE_SEAM) return false;
      return readFileSync(file, 'utf8').includes('createRecordsClient');
    });
    expect(builders.map((file) => relative(REPO, file))).toEqual([]);
  });
});
