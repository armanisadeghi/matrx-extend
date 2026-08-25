#!/usr/bin/env tsx
/**
 * Generate a JSON spec of every client tool the extension exposes.
 *
 *   pnpm catalog:tools                    → writes types/tool-catalog.json
 *   pnpm catalog:tools --markdown         → also writes types/tool-catalog.md
 *   pnpm catalog:tools --out path/to.json → custom path
 *
 * Status: **dev / debug only**. As of the registry redesign
 * (common-docs/systems/agents/agent-tools/STATE.md, May 2026), aidream loads tool
 * definitions from `public.tools` in the database, NOT from this catalog.
 * Adding/renaming a tool requires a SQL seed PR or admin-API call against
 * aidream — re-running this script does not propagate changes anywhere.
 *
 * Useful for: local diff-against-DB checks, the Tools tab UI in the
 * sidepanel, the matrx-extend-tool-display skill's documentation lookups.
 *
 * The previously-emitted `types/server-handoff/browser-dom-capability.json`
 * was retired with the redesign. We no longer write it.
 *
 * NOTE: this script imports the registry, which transitively imports every
 * handler module. The handlers wrap all `chrome.*` access inside `run()`
 * closures, so loading them in Node is safe — we don't execute any tool.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { buildToolCatalogManifest } from '../src/lib/tools/catalog';

interface CliArgs {
  out: string;
  markdown: boolean;
  pretty: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out = argv.includes('--out')
    ? (argv[argv.indexOf('--out') + 1] ?? 'types/tool-catalog.json')
    : 'types/tool-catalog.json';
  const markdown = argv.includes('--markdown') || argv.includes('--md');
  const pretty = !argv.includes('--compact');
  return { out, markdown, pretty };
}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function toMarkdown(manifest: ReturnType<typeof buildToolCatalogManifest>): string {
  const lines: string[] = [];
  lines.push('# matrx-extend client tool catalog');
  lines.push('');
  lines.push(`Generated: ${manifest.generated_at}`);
  lines.push('');
  lines.push(`- **Total tools:** ${manifest.tools.length}`);
  lines.push(`- **Assistant bundle:** ${manifest.assistant_bundle.length} tools (read-only)`);
  lines.push(
    `- **Pilot bundle:** ${manifest.pilot_bundle.length} tools (read + action + ask-user)`,
  );
  lines.push(
    `- **Pilot+privileged bundle:** ${manifest.pilot_with_privileged_bundle.length} tools`,
  );
  lines.push('');
  const byTier: Record<string, typeof manifest.tools> = {};
  for (const t of manifest.tools) {
    (byTier[t.tier] ??= []).push(t);
  }
  for (const tier of ['read', 'action', 'ask-user', 'privileged'] as const) {
    const items = byTier[tier];
    if (!items?.length) continue;
    lines.push('');
    lines.push(`## Tier: ${tier} (${items.length})`);
    for (const t of items) {
      lines.push('');
      lines.push(`### \`${t.name}\``);
      lines.push('');
      // Descriptions are NOT emitted here — they live ONLY in the DB and are
      // generated into docs/TOOLS.generated.md from tool_def (Rule 4). This
      // code-sourced catalog covers the structural contract (schema, perms).
      lines.push(
        `- **Required permissions:** ${t.required_permissions.length ? t.required_permissions.map((p) => `\`${p}\``).join(', ') : '(none)'}`,
      );
      lines.push(`- **Surface bundles:** ${t.surface_bundles.join(', ')}`);
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(t.input_schema, null, 2));
      lines.push('```');
    }
  }
  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));
const manifest = buildToolCatalogManifest();

const outPath = resolve(process.cwd(), args.out);
ensureDir(outPath);
writeFileSync(outPath, args.pretty ? JSON.stringify(manifest, null, 2) : JSON.stringify(manifest));
console.log(`✓ wrote ${manifest.tools.length} tools to ${outPath}`);

if (args.markdown) {
  const mdPath = outPath.replace(/\.json$/, '.md');
  writeFileSync(mdPath, toMarkdown(manifest));
  console.log(`✓ wrote markdown summary to ${mdPath}`);
}

console.log('');
console.log('Bundles:');
console.log(`  assistant            (${manifest.assistant_bundle.length}) — read-only`);
console.log(`  pilot                (${manifest.pilot_bundle.length}) — read + action + ask-user`);
console.log(`  pilot+privileged     (${manifest.pilot_with_privileged_bundle.length}) — full kit`);
