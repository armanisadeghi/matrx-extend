#!/usr/bin/env node
/**
 * Reads types/tool-catalog.json + reaches into Supabase to read tl_def parameters,
 * then emits per-tool UPDATE SQL that rewrites tl_def.parameters to match the
 * local catalog's input_schema. The DB convention is { field: { ...props, required: true? } }
 * while the catalog stores { properties: { field: {...} }, required: [field] }.
 *
 * Usage: tsx scripts/emit-sync-sql.mjs <tool_name> [<tool_name> ...]
 *
 * Output: ready-to-paste SQL via stdout.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'types/tool-catalog.json'), 'utf8'));
const byName = new Map(catalog.tools.map((t) => [t.name, t]));

const wanted = process.argv.slice(2);
if (!wanted.length) {
  console.error('Usage: emit-sync-sql.mjs <tool_name> [<tool_name> ...]');
  process.exit(1);
}

function toDbParams(inputSchema) {
  const props = inputSchema?.properties ?? {};
  const requiredSet = new Set(inputSchema?.required ?? []);
  const out = {};
  for (const [key, def] of Object.entries(props)) {
    // Strip JSON-Schema-only meta we don't want in DB
    const { ...rest } = def;
    delete rest.$schema;
    if (requiredSet.has(key)) rest.required = true;
    out[key] = rest;
  }
  return out;
}

function sqlEscape(s) {
  return s.replace(/'/g, "''");
}

const lines = [];
lines.push('-- Phase 5b parameter rewrites (one UPDATE per tool).');
lines.push('-- All parameter shapes derived directly from types/tool-catalog.json.');
lines.push('');

for (const name of wanted) {
  const t = byName.get(name);
  if (!t) {
    console.error(`WARN: ${name} not in local catalog — skipping`);
    continue;
  }
  const params = toDbParams(t.input_schema);
  const json = JSON.stringify(params);
  lines.push(`UPDATE public.tl_def SET parameters = '${sqlEscape(json)}'::jsonb, version = version + 1, updated_at = now() WHERE name = '${name}';`);
}

console.log(lines.join('\n'));
