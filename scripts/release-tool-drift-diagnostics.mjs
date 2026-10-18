import { readFileSync } from 'node:fs';

// The release artifact must never contain raw Supabase or server responses.
// Accept only complete, literal categories emitted by the strict gate.
const input = readFileSync(process.argv[2], 'utf8');
const categories = new Set();
for (const line of input.split(/\r?\n/)) {
  const match = line.match(
    /^drift-check: verification unavailable \((catalog-read|server-contract|bundle-membership)\)$/,
  );
  if (match) categories.add(match[1]);
}
console.log(`tool-drift-verification=${categories.size === 1 ? [...categories][0] : 'unknown'}`);
