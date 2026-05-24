#!/usr/bin/env tsx
/**
 * Generate docs/TOOLS.generated.md FROM THE DATABASE (public.tl_def,
 * source_app=matrx-extend).
 *
 * This file is the ONLY copy of tool descriptions allowed in the repo (Rule 4,
 * docs/TOOL_SOURCE_OF_TRUTH.md): descriptions live in the DB, and this doc is
 * always freshly regenerated from it — never hand-edited, never drifting.
 *
 *   pnpm docs:tools
 *
 * Wired into release.sh. NEVER blocks (Rule 6): if DB credentials are absent or
 * the fetch fails, it warns loudly and leaves the existing file untouched.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fetchPublicJson, loadSupabaseEnv } from './_supabase-rest';

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
    rows = await fetchPublicJson<DbToolRow[]>(
      env.url,
      env.key,
      'tl_def?source_app=eq.matrx-extend&select=name,description,tier,category,admin_only,parameters,is_active&order=category.asc,name.asc',
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
  lines.push('> **AUTO-GENERATED — do not edit.** Produced from `public.tl_def`');
  lines.push('> (`source_app=matrx-extend`), the source of truth. Tool names,');
  lines.push('> descriptions, and argument contracts live ONLY in the database');
  lines.push('> (Rule 4, [docs/TOOL_SOURCE_OF_TRUTH.md](./TOOL_SOURCE_OF_TRUTH.md)).');
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
