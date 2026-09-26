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
 * (Rule 4, common-docs/systems/agents/agent-tools/STATE.md): descriptions live in the DB,
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
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { isDbToolRow, type DbToolRow } from './_tool-db-row-validation';
import { selectRowsViaManagementApi } from './_supabase-management';
import { fetchPublicJson, loadSupabaseEnv } from './_supabase-rest';

const EXECUTOR_NAME = 'chrome-extension';

interface DbBindingRow {
  tool_id: string;
  executor_name: string;
  is_active: boolean;
}

async function fetchToolsViaManagementApi(): Promise<DbToolRow[]> {
  return selectRowsViaManagementApi(
    `select distinct d.id, d.source_kind, d.name, d.description, d.tier, d.category, d.admin_only, d.parameters, d.is_active from tool.definition d join tool.binding b on b.tool_id = d.id where b.is_active and (b.executor_name = '${EXECUTOR_NAME}' or b.executor_name like '${EXECUTOR_NAME}.%') order by d.category, d.name`,
    isDbToolRow,
  );
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

export async function main(): Promise<void> {
  const env = loadSupabaseEnv();
  let rows: DbToolRow[];
  try {
    if (!env) throw new Error('publishable credentials absent');
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
      `definition?id=in.${inList}&select=id,source_kind,name,description,tier,category,admin_only,parameters,is_active&order=category.asc,name.asc`,
      'tool',
    );
    if (!Array.isArray(rows) || !rows.every(isDbToolRow)) throw new Error('Invalid public tool definition rows');
  } catch (err) {
    try {
      rows = await fetchToolsViaManagementApi();
      console.log('docs:tools — private tool catalog read through Supabase Management API');
    } catch (managementError) {
      console.warn(
        `docs:tools — DB fetch failed; leaving docs/TOOLS.generated.md untouched. Publishable read: ${(err as Error).message}; Management API read: ${String(managementError)}`,
      );
      return;
    }
  }

  if (rows.length === 0) {
    console.warn('docs:tools — no verified tool definitions; leaving docs/TOOLS.generated.md untouched.');
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
  lines.push('> common-docs/systems/agents/agent-tools/STATE.md).');
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

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.warn(
      `docs:tools — unexpected error; docs/TOOLS.generated.md untouched. ${(err as Error).message}`,
    );
  });
}
