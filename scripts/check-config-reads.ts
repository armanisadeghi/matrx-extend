#!/usr/bin/env tsx
/**
 * check:config-reads — config attestation drift guard. Every knob / app-config read must go through the
 * counted door in src/lib/config/. Refused outside src/lib/config/, src/lib/settings/platform-knobs.ts
 * (the one knob_snapshot reader, which records each key it serves), tests and generated code:
 *   rpc('knob_resolve' | 'knob_snapshot'), from('app_config'), from('feature_knob').
 * Exit 0 clean · 1 offender.     pnpm check:config-reads [--self-test]
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
// A second app_config reader: building one, fetching the row (PostgREST or aidream route), or importing the reader package.
const SECOND_READER =
  /createAppConfigReader|@ai-matrx\/data\/app-config|rest\/v1\/app_config|\/app-config\//;
const RAW =
  /rpc\(\s*['"`](knob_resolve|knob_snapshot)['"`]|from\(\s*['"`](app_config|feature_knob)['"`]/;
const ALLOWED = (rel: string) =>
  rel.startsWith('src/lib/config/') ||
  rel === 'src/lib/settings/platform-knobs.ts' ||
  rel.includes('/generated/');

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e)) yield p;
  }
}

function run(root: string): number {
  const bad: string[] = [];
  for (const f of walk(join(root, 'src'))) {
    const rel = relative(root, f);
    if (ALLOWED(rel)) continue;
    readFileSync(f, 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (RAW.test(l) || SECOND_READER.test(l))
          bad.push(`${rel}:${i + 1}  ${l.trim().slice(0, 100)}`);
      });
  }
  if (bad.length) {
    console.error(
      `check:config-reads: ${bad.length} raw config read(s) outside src/lib/config/ (use resolveKnob / appConfig):\n  ${bad.join('\n  ')}`,
    );
    return 1;
  }
  console.log('check:config-reads: clean');
  return 0;
}

if (process.argv.includes('--self-test')) {
  const dir = mkdtempSync(join(tmpdir(), 'ccr-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const x = 1;\n');
  const clean = run(dir);
  writeFileSync(join(dir, 'src', 'a.ts'), "db.rpc('knob_resolve', {});\n");
  const red = run(dir);
  writeFileSync(join(dir, 'src', 'a.ts'), 'const r = createAppConfigReader({});\n');
  const red2 = run(dir);
  console.log(
    clean === 0 && red === 1 && red2 === 1
      ? 'self-test PASS'
      : `self-test FAIL ${clean} ${red} ${red2}`,
  );
  process.exit(clean === 0 && red === 1 && red2 === 1 ? 0 : 1);
}
process.exit(run(ROOT));
