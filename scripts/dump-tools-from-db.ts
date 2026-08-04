#!/usr/bin/env tsx
/**
 * Generate docs/TOOLS.generated.md FROM THE DATABASE.
 *
 * Source query (post 2026-06 schema canonicalization):
 *   `tool.definition` rows ⋈ `tool.binding` where
 *   `executor_name = 'chrome-extension'` (or any `chrome-extension.*`
 *   sub-executor). These tables moved from `public` to the `tool` schema
 *   in the 2026-06 DB canonicalization. Ownership lives on the binding row.
 *
 * This file is the ONLY copy of tool descriptions allowed in the repo
 * (Rule 4, docs/TOOL_SOURCE_OF_TRUTH.md): descriptions live in the DB,
 * and this doc is always freshly regenerated from it — never hand-edited,
 * never drifting.
 *
 *   pnpm docs:tools
 *
 * Wired into release.sh. NEVER blocks (Rule 6): if DB credentials are
 * absent or the fetch fails, it warns loudly and leaves the existing file
 * untouched.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fetchPublicJson, loadSupabaseEnv } from './_supabase-rest';

const EXECUTOR_NAME = 'chrome-extension';

interface DbBindingRow {
  tool_id: string;
  executor_name: string;
  is_active: boolean;
}

interface DbToolRow {
  name: string;
  description: string | null;
  tier: string | null;
  category: string | null;
  admin_only: boolean | null;
  parameters: Record<
    string,
    { type?: string | string[]; required?: boolean; enum?: unknown[]; default?: unknown }
  > | null;
  is_active: boolean | null;
}

function paramSummary(params: DbToolRow['parameters']): string {
  if (!params || Object.keys(params).length === 0) return '_No parameters._';
  const parts = Object.entries(params).map(([name, def]) => {
    const t = def?.type;
    const type = Array.isArray(t) ? t.join('|') : (t ?? 'any');
    const req = def?.required ? ', required' : '';
    const en = def?.enum ? ` = ${JSON.stringify(def.enum)}` : '';
    return `\`${name}\` (${type}${req})${en}`;
  });
  return parts.join('; ');
}

async function main(): Promise<void> {
  const env = loadSupabaseEnv();
  if (!env) {
    console.warn(
      'docs:tools — Supabase creds not found; leaving docs/TOOLS.generated.md untouched. ' +
        'A build/CI with creds present regenerates it from the DB.',
    );
    return;
  }

  let rows: DbToolRow[];
  try {
    // Two-step: bindings → ids → defs. The PostgREST embedded-filter
    // pattern `tool_binding.executor_name=eq.chrome-extension` only filters
    // joined rows, not the parent — explicit two-step gives precise results.
    // Post 2026-06 canonicalization: tool_binding → tool.binding, tool_def → tool.definition
    const bindings = await fetchPublicJson<DbBindingRow[]>(
      env.url,
      env.key,
      `binding?or=(executor_name.eq.${EXECUTOR_NAME},executor_name.like.${EXECUTOR_NAME}.*)&select=tool_id,executor_name,is_active`,
      'tool',
    );
    const ids = [...new Set(bindings.filter((b) => b.is_active).map((b) => b.tool_id))];
    if (ids.length === 0) {
      console.warn(
        'docs:tools — no chrome-extension bindings found in DB; leaving docs/TOOLS.generated.md untouched.',
      );
      return;
    }
    const inList = `(${ids.map((i) => `"${i}"`).join(',')})`;
    rows = await fetchPublicJson<DbToolRow[]>(
      env.url,
      env.key,
      `definition?id=in.${inList}&select=name,description,tier,category,admin_only,parameters,is_active&order=category.asc,name.asc`,
      'tool',
    );
  } catch (err) {
    console.warn(
      `docs:tools — DB fetch failed; leaving docs/TOOLS.generated.md untouched. ${(err as Error).message}`,
    );
    return;
  }

  const active = rows.filter((r) => r.is_active !== false);
  const byCat = new Map<string, DbToolRow[]>();
  for (const r of active) {
    const c = r.category ?? '(uncategorized)';
    const existing = byCat.get(c);
    if (existing) existing.push(r);
    else byCat.set(c, [r]);
  }

  const lines: string[] = [];
  lines.push('# matrx-extend tools');
  lines.push('');
  lines.push('> **AUTO-GENERATED — do not edit.** Produced from `tool.definition`');
  lines.push("> rows bound to `executor_name='chrome-extension'` via `tool.binding`,");
  lines.push('> the source of truth. Tool names, descriptions, and argument');
  lines.push('> contracts live ONLY in the database (Rule 4,');
  lines.push('> [docs/TOOL_SOURCE_OF_TRUTH.md](./TOOL_SOURCE_OF_TRUTH.md)).');
  lines.push('> Regenerate with `pnpm docs:tools` (also runs on every `release.sh`).');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total tools: ${active.length}`);
  lines.push('');

  for (const cat of [...byCat.keys()].sort()) {
    lines.push(`## ${cat}`);
    lines.push('');
    for (const r of byCat.get(cat) ?? []) {
      const badges = [r.tier ?? 'read', r.admin_only ? 'admin-only' : null]
        .filter(Boolean)
        .join(' · ');
      lines.push(`### \`${r.name}\``);
      lines.push('');
      lines.push(`_${badges}_`);
      lines.push('');
      lines.push(r.description ?? '_(no description in DB)_');
      lines.push('');
      lines.push(`**Parameters:** ${paramSummary(r.parameters)}`);
      lines.push('');
    }
  }

  const out = resolve(process.cwd(), 'docs/TOOLS.generated.md');
  writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(`✓ wrote ${active.length} tools to docs/TOOLS.generated.md`);
}

main().catch((err) => {
  console.warn(
    `docs:tools — unexpected error; docs/TOOLS.generated.md untouched. ${(err as Error).message}`,
  );
});
