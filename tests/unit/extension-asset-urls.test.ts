/**
 * Every `chrome.runtime.getURL('<literal>')` in src must name a file the build
 * ships: a public/ asset or an HTML entrypoint. A wrong path fails silently at
 * runtime (Chrome drops a notification whose icon 404s), so it is caught here.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');
const GET_URL = /runtime\.getURL\(\s*['"`]([^'"`$]+)['"`]\s*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function ships(path: string): boolean {
  const clean = path.replace(/^\//, '').split(/[?#]/)[0] ?? '';
  if (existsSync(join(ROOT, 'public', clean))) return true;
  const html = clean.match(/^([\w-]+)\.html$/);
  if (html) {
    const entry = html[1] ?? '';
    return (
      existsSync(join(SRC, 'entrypoints', entry, 'index.html')) ||
      existsSync(join(SRC, 'entrypoints', `${entry}.html`))
    );
  }
  return false;
}

/** Literal paths of non-asset kinds the build emits itself. */
const BUILD_EMITTED = /^\/?(content-scripts\/|chunks\/|assets\/|[\w-]+\.(js|css)$)/;

describe('extension asset URLs', () => {
  it('every literal getURL path names a file the build ships', () => {
    const missing: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(GET_URL)) {
        const path = m[1] ?? '';
        if (BUILD_EMITTED.test(path) || ships(path)) continue;
        missing.push(`${relative(ROOT, file)}: ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('can fail: a made-up icon path is not shipped', () => {
    expect(ships('icon-128.png')).toBe(false);
    expect(ships('icon/128.png')).toBe(true);
    expect(ships('/screenshot-editor.html')).toBe(true);
  });
});
