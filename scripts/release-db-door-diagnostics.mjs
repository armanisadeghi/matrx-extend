import { readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

// Only paths, counts and known failure classes leave the raw gate log. Never
// publish source lines, exception stacks, or arbitrary command output.
const input = stripVTControlCharacters(readFileSync(process.argv[2], 'utf8'));
let recognized = false;
for (const line of input.split('\n')) {
  const growth = line.match(
    /^\s*matrx-extend:([A-Za-z0-9_./-]+): (\d+) direct database call\(s\), baseline (\d+)\s*$/,
  );
  if (!growth || growth[1].split('/').includes('..') || growth[1].startsWith('/')) continue;
  console.log(`db-door-growth file=${growth[1]} calls=${growth[2]} baseline=${growth[3]}`);
  recognized = true;
}
if (/Cannot find module ['"]typescript['"]/.test(input)) {
  console.log('db-door-setup=missing-typescript');
  recognized = true;
} else if (/\b(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)\b/.test(input)) {
  console.log('db-door-setup=missing-module');
  recognized = true;
}
if (/check-db-doors: UNMEASURED/.test(input)) {
  console.log('db-door-setup=unmeasured-checkout');
  recognized = true;
}
if (!recognized) console.log('db-door-failure=unrecognized-output');
