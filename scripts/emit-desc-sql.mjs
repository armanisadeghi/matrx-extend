#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'types/tool-catalog.json'), 'utf8'),
);
const byName = new Map(catalog.tools.map((t) => [t.name, t]));

function sqlEscape(s) {
  return s.replace(/'/g, "''");
}

const wanted = process.argv.slice(2);
const lines = [];
for (const name of wanted) {
  const t = byName.get(name);
  if (!t) {
    process.stderr.write(`WARN: ${name} not in catalog\n`);
    continue;
  }
  lines.push(
    `UPDATE public.tl_def SET description = '${sqlEscape(t.description)}', version = version + 1, updated_at = now() WHERE name = 'matrx-extend:${name}';`,
  );
}
console.log(lines.join('\n'));
