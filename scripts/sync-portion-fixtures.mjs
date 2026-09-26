#!/usr/bin/env node
// The extension's portioner is pinned to the SERVER's fixtures (aidream
// packages/matrx-scraper/tests/fixtures/portions/*.json — the server portioner
// is the single truth). This copies them into tests/fixtures/portions.
//   node scripts/sync-portion-fixtures.mjs          copy (re-pin)
//   node scripts/sync-portion-fixtures.mjs --check  exit 1 if any copy drifted
// AIDREAM_DIR overrides the sibling checkout location.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_DIR = resolve(
  process.env.AIDREAM_DIR ?? resolve(root, '../aidream'),
  'packages/matrx-scraper/tests/fixtures/portions',
);
export const LOCAL_DIR = resolve(root, 'tests/fixtures/portions');

export function portionFixtureDrift() {
  const names = (d) =>
    existsSync(d)
      ? readdirSync(d)
          .filter((f) => f.endsWith('.json'))
          .sort()
      : [];
  const server = names(SERVER_DIR);
  const local = names(LOCAL_DIR);
  const drift = [];
  for (const f of new Set([...server, ...local])) {
    if (!server.includes(f)) drift.push(`${f}: only in the extension copy`);
    else if (!local.includes(f)) drift.push(`${f}: missing from the extension copy`);
    else if (!readFileSync(resolve(SERVER_DIR, f)).equals(readFileSync(resolve(LOCAL_DIR, f))))
      drift.push(`${f}: differs from the server's`);
  }
  return { server, drift };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(SERVER_DIR)) {
    console.error(`aidream fixtures not found at ${SERVER_DIR} (set AIDREAM_DIR).`);
    process.exit(2);
  }
  const { server, drift } = portionFixtureDrift();
  if (process.argv.includes('--check')) {
    if (drift.length) {
      console.error(
        `Portion fixtures drifted from aidream:\n  ${drift.join('\n  ')}\nRun: node scripts/sync-portion-fixtures.mjs`,
      );
      process.exit(1);
    }
    console.log(`Portion fixtures match aidream (${server.length} files).`);
  } else {
    for (const f of server)
      writeFileSync(resolve(LOCAL_DIR, f), readFileSync(resolve(SERVER_DIR, f)));
    console.log(`Copied ${server.length} portion fixtures from ${SERVER_DIR}.`);
  }
}
