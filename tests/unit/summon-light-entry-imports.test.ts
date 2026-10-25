// summon final review 3 (2026-10-25, census 2 partial): the extension imported `formatLinkToken` from
// `@ai-matrx/summon/open`, the heavy entry (registry verbs, selectors, creators), when the light
// `@ai-matrx/summon/boot-kit` exports the same helper. Shipped source must reach summon's link grammar through
// the light entry; this fails when a `@ai-matrx/summon/open` import comes back.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../src');
const HEAVY =
  /from\s+['"]@ai-matrx\/summon\/open['"]|import\(\s*['"]@ai-matrx\/summon\/open['"]\s*\)/;

function heavyImporters(files: Array<{ file: string; text: string }>): string[] {
  return files.filter((f) => HEAVY.test(f.text)).map((f) => f.file);
}

function shippedSources(dir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') out.push(...shippedSources(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push({ file: path.relative(SRC, p), text: readFileSync(p, 'utf8') });
    }
  }
  return out;
}

describe('summon is reached through its light entries', () => {
  it('no shipped source imports @ai-matrx/summon/open', () => {
    expect(heavyImporters(shippedSources(SRC))).toEqual([]);
  });

  it('the scan names a planted heavy import', () => {
    expect(
      heavyImporters([
        { file: 'a.ts', text: "import { formatLinkToken } from '@ai-matrx/summon/open';" },
        { file: 'b.ts', text: "import { formatLinkToken } from '@ai-matrx/summon/boot-kit';" },
      ]),
    ).toEqual(['a.ts']);
  });
});
