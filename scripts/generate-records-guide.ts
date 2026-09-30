#!/usr/bin/env tsx
/**
 * Generates the browser's records-guide artifact from the server's sole
 * `guide_for` implementation. The artifact is the browser executor's exact
 * read-only response surface; never hand-edit it.
 *
 * `pnpm catalog:records-guide -- --source <aidream-root>` writes the artifact.
 * `pnpm catalog:records-guide -- --check --source <aidream-root>` proves every
 * action's payload and unknown-topic fallback still exactly match the server.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const outputArgument = process.argv.indexOf('--output');
const sourceArgument = process.argv.indexOf('--source');
const OUTPUT =
  outputArgument === -1
    ? resolve(ROOT, 'src/lib/tools/generated/records-guide.json')
    : resolve(process.argv.at(outputArgument + 1) ?? '');
const AIDREAM = resolve(process.argv.at(sourceArgument + 1) ?? '');
const UNKNOWN_TOPIC_TOKEN = '__MATRX_RECORDS_UNKNOWN_GUIDE_TOPIC__';
const PROGRAM = [
  'import json',
  'from matrx_records.agent.args import RECORD_ACTIONS',
  'from matrx_records.agent.definition import guide_for',
  `unknown_topic = ${JSON.stringify(UNKNOWN_TOPIC_TOKEN)}`,
  'print(json.dumps({"topics": {a: guide_for(a) for a in RECORD_ACTIONS if a != "guide"}, "empty": guide_for(None), "unknown": guide_for(unknown_topic), "unknown_topic_quoted": repr(unknown_topic)}, ensure_ascii=False, sort_keys=True, indent=2))',
].join('; ');

if (sourceArgument === -1 || !process.argv.at(sourceArgument + 1)) {
  throw new Error('Missing canonical records source; pass --source <aidream-root>.');
}
if (!existsSync(AIDREAM)) {
  throw new Error(`Canonical records source is unavailable: ${AIDREAM}`);
}
if (outputArgument !== -1 && !process.argv.at(outputArgument + 1)) {
  throw new Error('--output requires a file path');
}

const generated = execFileSync('uv', ['run', 'python', '-c', PROGRAM], {
  cwd: AIDREAM,
  encoding: 'utf8',
});

if (check) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== generated) {
    const diagnosticDirectory = mkdtempSync(resolve(tmpdir(), 'matrx-records-guide-'));
    const generatedPath = resolve(diagnosticDirectory, 'records-guide.json');
    writeFileSync(generatedPath, generated);
    let difference = '';
    try {
      execFileSync('diff', ['--unified=3', '--label', 'checked-in', OUTPUT, '--label', 'generated', generatedPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      difference = error instanceof Error && 'stdout' in error ? String(error.stdout) : '';
    } finally {
      rmSync(diagnosticDirectory, { force: true, recursive: true });
    }
    throw new Error(
      `records guide artifact differs from aidream guide_for; run pnpm catalog:records-guide\n${difference}`,
    );
  }
  console.log('records guide matches aidream guide_for for every action');
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, generated);
  console.log(`wrote canonical records guide artifact to ${OUTPUT}`);
}
