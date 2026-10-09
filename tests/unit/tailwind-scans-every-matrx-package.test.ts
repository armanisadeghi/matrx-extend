/**
 * Tailwind generates a utility only if a scanned source uses it. The package chat wears classes
 * from many @ai-matrx packages, several of which pnpm installs only TRANSITIVELY (under
 * node_modules/.pnpm/node_modules). A hand list of package dist folders silently left them
 * unstyled in the extension (2026-10-08: animate-shimmer, canvas, rich-editor, diff, print …).
 * The entry stylesheet must scan both directories that hold every installed @ai-matrx package.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENTRY = process.env.TAILWIND_ENTRY ?? resolve(__dirname, '../../src/styles/globals.css');
const sources = [...readFileSync(ENTRY, 'utf8').matchAll(/@source\s+"([^"]+)"/g)].map((m) =>
  resolve(dirname(ENTRY), m[1] as string),
);

function installedMatrxPackageDirs(): string[] {
  const root = resolve(__dirname, '../..');
  const dirs: string[] = [];
  for (const base of ['node_modules/@ai-matrx', 'node_modules/.pnpm/node_modules/@ai-matrx']) {
    const abs = join(root, base);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) dirs.push(join(abs, name));
  }
  return dirs;
}

describe('the Tailwind entry scans every installed @ai-matrx package', () => {
  it('each installed package (direct or transitive) sits under a scanned source', () => {
    const unscanned = installedMatrxPackageDirs().filter(
      (dir) => !sources.some((src) => dir === src || dir.startsWith(`${src}/`)),
    );
    expect(unscanned).toEqual([]);
  });
});
