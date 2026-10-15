#!/usr/bin/env tsx
/**
 * check:settings-hardcoded — a NEW hard-coded setting in the extension (law 6: opinions become knobs).
 * Modelled on matrx-frontend's guard of the same name. Two rules, one RATCHET:
 *   1. a module-level `const MAX_/MIN_…` or `…_LIMIT/_TIMEOUT/_MS/_THRESHOLD/_INTERVAL/_SIZE/_TTL/_RETRIES`
 *      whose value is a bare number/boolean;
 *   2. a `*.matrxserver.com` URL string literal (a server address belongs in public.app_config 'matrx-extend').
 * The current set is baselined in scripts/settings-hardcoded-allowlist.json; the guard fails only on what is
 * NEW. `--write` only REMOVES entries that no longer exist: it can never add one (growing the baseline takes a
 * hand edit with a person behind it). Allowed anywhere: src/config/ (build bootstrap), tests, wxt.config.ts.
 *
 *   pnpm check:settings-hardcoded [--write] [--self-test]     Exit 0 clean · 1 new offender · 2 scanned nothing
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ALLOWLIST = join(ROOT, 'scripts', 'settings-hardcoded-allowlist.json');
const NAME_RE = /^(MAX|MIN)_|_(LIMIT|LIMITS|TIMEOUT|TIMEOUT_MS|MS|THRESHOLD|INTERVAL|INTERVAL_MS|SIZE|TTL|TTL_MS|RETRY|RETRIES)$/;
const STRUCTURAL_RE = /(^|_)(MS_PER|SECONDS_PER|BYTES_PER|PER_SECOND|PER_MINUTE|NOT_FOUND|INDEX|VERSION)(_|$)/;
const CONST_RE = /^[ \t]*(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})(?:\s*:\s*[\w<>[\], |]+)?\s*=\s*(-?\d[\d_]*(?:\.\d+)?|true|false)\s*(?:as\s+const\s*)?[;,\n]/gm;
const URL_RE = /['"`](https?:\/\/[a-z0-9.-]*matrxserver\.com[^'"`]*)['"`]/g;
const KNOB_MIRROR_RE = /knob[ -]?mirror/i;

interface Site { file: string; id: string; line: number }

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules' && e !== 'generated') yield* walk(p); }
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e)) yield p;
  }
}

export function scan(root: string): Site[] {
  const out: Site[] = [];
  const src = join(root, 'src');
  for (const f of walk(src)) {
    const rel = relative(root, f);
    if (rel.startsWith('src/config/') || rel.startsWith('src/lib/config/bundled-app-config')) continue;
    const text = readFileSync(f, 'utf8');
    const lines = text.split('\n');
    const lineOf = (i: number) => text.slice(0, i).split('\n').length;
    for (const m of text.matchAll(CONST_RE)) {
      const name = m[1]!;
      if (!NAME_RE.test(name) || STRUCTURAL_RE.test(name)) continue;
      const line = lineOf(m.index!);
      if (lines.slice(Math.max(0, line - 7), line - 1).some((l) => KNOB_MIRROR_RE.test(l))) continue;
      out.push({ file: rel, id: name, line });
    }
    for (const m of text.matchAll(URL_RE)) out.push({ file: rel, id: `url:${new URL(m[1]!).host}`, line: lineOf(m.index!) });
  }
  return out;
}

const key = (s: { file: string; id: string }) => `${s.file}::${s.id}`;

function run(root: string, allowFile: string, write: boolean): number {
  const sites = scan(root);
  if (sites.length === 0 && !existsSync(join(root, 'src'))) { console.error('check:settings-hardcoded UNMEASURED: scanned nothing'); return 2; }
  const allow: Array<{ file: string; id: string }> = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
  const allowed = new Set(allow.map(key));
  const present = new Set(sites.map(key));
  const fresh = sites.filter((s) => !allowed.has(key(s)));
  if (write) {
    const kept = allow.filter((a) => present.has(key(a)));
    writeFileSync(allowFile, `${JSON.stringify(kept, null, 2)}\n`);
    console.log(`check:settings-hardcoded: allowlist shrunk ${allow.length} -> ${kept.length} (never grows)`);
  }
  if (fresh.length) {
    console.error(`check:settings-hardcoded: ${fresh.length} NEW hard-coded setting(s) — make each a knob or an app_config key ('matrx-extend'), or carry a KNOB MIRROR comment:`);
    for (const s of fresh) console.error(`  ${s.file}:${s.line}  ${s.id}`);
    return 1;
  }
  console.log(`check:settings-hardcoded: clean (${sites.length} baselined, 0 new)`);
  return 0;
}

function selfTest(): number {
  const dir = mkdtempSync(join(tmpdir(), 'shc-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const FOO = 3;\n');
  const allow = join(dir, 'allow.json');
  writeFileSync(allow, '[]');
  const clean = run(dir, allow, false);
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const MAX_FOO_MS = 5000;\nconst u = "https://x.server.app.matrxserver.com";\n');
  const red = run(dir, allow, false);
  const noGrow = (run(dir, allow, true), JSON.parse(readFileSync(allow, 'utf8')).length);
  const ok = clean === 0 && red === 1 && noGrow === 0;
  console.log(ok ? 'self-test PASS (clean=0, new offender=1, --write never adds)' : `self-test FAIL clean=${clean} red=${red} grew=${noGrow}`);
  return ok ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run(ROOT, ALLOWLIST, process.argv.includes('--write')));
