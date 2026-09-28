#!/usr/bin/env tsx
/**
 * Generates the browser's records-guide artifact from the server's sole
 * `guide_for` implementation. The artifact is the browser executor's exact
 * read-only response surface; never hand-edit it.
 *
 * `pnpm catalog:records-guide` writes the artifact.
 * `pnpm catalog:records-guide --check` proves every action's `how` and
 * argument payload still exactly match the server implementation.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const AIDREAM = resolve(ROOT, '../aidream');
const check = process.argv.includes('--check');
const outputArgument = process.argv.indexOf('--output');
const OUTPUT =
  outputArgument === -1
    ? resolve(ROOT, 'src/lib/tools/generated/records-guide.json')
    : resolve(process.argv.at(outputArgument + 1) ?? '');
const PROGRAM = [
  'import json',
  'from matrx_records.agent.args import RECORD_ACTIONS',
  'from matrx_records.agent.definition import guide_for',
  'print(json.dumps({a: guide_for(a) for a in RECORD_ACTIONS if a != "guide"}, ensure_ascii=False, sort_keys=True, indent=2))',
].join('; ');

if (!existsSync(AIDREAM)) throw new Error(`Canonical records source is unavailable: ${AIDREAM}`);
if (outputArgument !== -1 && !process.argv.at(outputArgument + 1)) {
  throw new Error('--output requires a file path');
}

const generated = execFileSync('uv', ['run', 'python', '-c', PROGRAM], {
  cwd: AIDREAM,
  encoding: 'utf8',
});

if (check) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== generated) {
    throw new Error(
      'records guide artifact differs from aidream guide_for; run pnpm catalog:records-guide',
    );
  }
  console.log('records guide matches aidream guide_for for every action');
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, generated);
  console.log(`wrote canonical records guide artifact to ${OUTPUT}`);
}
