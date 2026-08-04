#!/usr/bin/env node
/**
 * Dump current `tool.definition` + `tool.binding` state to a single readable
 * markdown file so the team can review what the LLM actually sees and flag
 * changes.
 *
 *   pnpm catalog:tools:db-dump            → writes types/tool-db-dump.md
 *
 * Source-of-truth schema (post 2026-06 canonicalization — tables moved from
 * `public` to the `tool` schema; see check-tool-db-drift.ts for details):
 *
 *   - `tool.definition`  — was public.tool_def: name, description, parameters,
 *                           tier, admin_only, category, is_active, source_kind.
 *   - `tool.binding`     — was public.tool_binding: (tool_id, executor_name,
 *                           is_active). Our claim: executor_name='chrome-extension'.
 *   - `tool.bundle`,
 *     `tool.bundle_member` — bundle inventory.
 *
 * Three sections:
 *   1. Tool inventory by executor (every row bound to chrome-extension,
 *      with description, tier, admin_only, params summary).
 *   2. Bundles inventory (every tool.bundle row + its tool.bundle_member
 *      tools, plus the empty bundles we keep around).
 *   3. Sources-of-truth audit — cross-references DB bundles with the
 *      local `CANONICAL_SURFACE` + `CATEGORY_BY_TOOL` + per-handler
 *      `surface_bundles`. Flags every divergence.
 *
 * Read this BEFORE proposing tool-shape changes. It's the only place
 * you can see all three sources of truth side-by-side.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const EXECUTOR_NAME = 'chrome-extension';

// ─── env loader (mirrors check-tool-db-drift.ts) ────────────────────────────

function loadEnv() {
  let url = process.env.SUPABASE_URL ?? process.env.WXT_SUPABASE_URL ?? '';
  let key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.WXT_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    '';
  if (!url || !key) {
    for (const f of [
      '.env.production.local',
      '.env.production',
      '.env.development.local',
      '.env.development',
      '.env',
    ]) {
      const p = resolve(ROOT, f);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
        if (!m) continue;
        const [, k, raw] = m;
        const v = (raw ?? '').replace(/^['"]|['"]$/g, '');
        if (!url && (k === 'WXT_SUPABASE_URL' || k === 'SUPABASE_URL')) url = v;
        if (
          !key &&
          (k === 'WXT_SUPABASE_PUBLISHABLE_KEY' ||
            k === 'SUPABASE_PUBLISHABLE_KEY' ||
            k === 'SUPABASE_ANON_KEY')
        )
          key = v;
      }
      if (url && key) break;
    }
  }
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not found in env or .env files');
    process.exit(2);
  }
  return { url, key };
}

async function fetchAll(url, key, table, select, extraQuery = '', schema = 'tool') {
  const qs = `select=${encodeURIComponent(select)}${extraQuery ? `&${extraQuery}` : ''}`;
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${table}?${qs}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      // Post 2026-06 canonicalization: tool tables moved to `tool` schema.
      'Accept-Profile': schema,
    },
  });
  if (!res.ok) {
    console.error(`Supabase fetch failed (${res.status}) on ${schema}.${table}: ${await res.text()}`);
    process.exit(2);
  }
  return res.json();
}

// ─── local refs (CANONICAL_SURFACE, CATEGORY_BY_TOOL, catalog) ──────────────

function loadLocalRefs() {
  const catFile = readFileSync(resolve(ROOT, 'src/lib/tools/categories.ts'), 'utf8');

  const surfaceMatch = catFile.match(/CANONICAL_SURFACE.*?Set<string>.*?\[(.*?)\]/s);
  const surface = surfaceMatch ? [...surfaceMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

  const cbtMatch = catFile.match(
    /CATEGORY_BY_TOOL:\s*Record<string,\s*ToolCategory>\s*=\s*{([\s\S]*?)};/,
  );
  const categoryByTool = {};
  if (cbtMatch) {
    for (const m of cbtMatch[1].matchAll(/['"]?([\w-]+)['"]?\s*:\s*'([\w-]+)'/g)) {
      categoryByTool[m[1]] = m[2];
    }
  }

  const catalogPath = resolve(ROOT, 'types/tool-catalog.json');
  const catalog = existsSync(catalogPath)
    ? JSON.parse(readFileSync(catalogPath, 'utf8'))
    : { tools: [] };

  return { canonicalSurface: new Set(surface), categoryByTool, catalog };
}

// ─── markdown helpers ───────────────────────────────────────────────────────

function escapeMd(s) {
  if (!s) return '';
  return String(s).replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function summarizeParams(params) {
  if (!params || typeof params !== 'object') return '_(no parameters)_';
  const entries = Object.entries(params);
  if (entries.length === 0) return '_(no parameters)_';
  return entries
    .map(([k, v]) => {
      const required = v && v.required === true ? '**' : '';
      const type = v?.type ? (Array.isArray(v.type) ? v.type.join('\\|') : v.type) : '?';
      const enumVals = v?.enum ? `[${v.enum.join('\\|')}]` : '';
      return `${required}${k}${required}: \`${type}${enumVals}\``;
    })
    .join(', ');
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const { url, key } = loadEnv();

  // Pull EVERY active tool.definition along with its executor bindings so we can
  // group by owner (chrome-extension vs everyone else) without paging.
  // `tool.binding` has ~200 rows total across the platform — small enough
  // to fetch in one shot. All tables are in the `tool` schema (2026-06 canon).
  const [allTools, allBindings, bundles, members, executors] = await Promise.all([
    fetchAll(
      url,
      key,
      'definition',
      'id,name,description,parameters,tier,admin_only,is_active,category,tool_group,source_kind,version,updated_at',
    ),
    fetchAll(url, key, 'binding', 'tool_id,executor_name,is_active'),
    fetchAll(url, key, 'bundle', 'id,name,description,metadata,is_active,is_system'),
    fetchAll(url, key, 'bundle_member', 'bundle_id,tool_id,local_alias,sort_order'),
    fetchAll(url, key, 'executor', 'name,description,parent_executor_name,is_active'),
  ]);

  // Group binding executors per tool_id.
  const executorsByTool = new Map();
  for (const b of allBindings) {
    if (!b.is_active) continue;
    if (!executorsByTool.has(b.tool_id)) executorsByTool.set(b.tool_id, []);
    executorsByTool.get(b.tool_id).push(b.executor_name);
  }

  // Index for tool_id → tool_name lookup (used by bundle membership table).
  const toolIdToName = new Map(allTools.map((t) => [t.id, t.name]));

  // Bucket tools by which executors own them. A tool can have multiple
  // bindings — count it once per executor for the inventory but list it
  // under its primary owner for the per-executor sections.
  const byExecutor = new Map();
  for (const t of allTools) {
    const owners = executorsByTool.get(t.id) ?? ['(unbound)'];
    for (const owner of owners) {
      if (!byExecutor.has(owner)) byExecutor.set(owner, []);
      byExecutor.get(owner).push(t);
    }
  }
  for (const list of byExecutor.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const { canonicalSurface, categoryByTool, catalog } = loadLocalRefs();
  const localByName = new Map(catalog.tools.map((t) => [t.name, t]));

  const lines = [];
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  lines.push('# Tool DB dump');
  lines.push('');
  lines.push(`Generated: ${now} UTC`);
  lines.push('');
  lines.push(`- **Total tools (\`tool.definition\`):** ${allTools.length}`);
  lines.push(
    `- **Total bindings (\`tool.binding\`, active):** ${allBindings.filter((b) => b.is_active).length}`,
  );
  lines.push(`- **Total bundles (\`tool.bundle\`):** ${bundles.length}`);
  lines.push(`- **Total bundle members (\`tool.bundle_member\`):** ${members.length}`);
  lines.push(`- **Total executors (\`tool.executor\`):** ${executors.length}`);
  lines.push('');
  lines.push('Read order:');
  lines.push('1. **Tool inventory** — every executor and its bound tools.');
  lines.push('2. **chrome-extension detail** — full per-tool description + params.');
  lines.push('3. **Bundles** — server-side groupings + their members.');
  lines.push('4. **Sources-of-truth audit** — divergences between DB and local code.');
  lines.push('');

  // ── 1. Tool inventory grouped by executor ───────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## 1. Tool inventory by `tool.binding.executor_name`');
  lines.push('');
  lines.push('A tool can appear under multiple executors if it has multiple active bindings.');
  lines.push('');

  for (const [executor, list] of [...byExecutor.entries()].sort()) {
    lines.push(`### \`${executor}\` — ${list.length} tools`);
    lines.push('');
    lines.push('| name | tier | admin | cat | source_kind | description |');
    lines.push('|---|---|---|---|---|---|');
    for (const t of list) {
      const tier = t.tier ?? '_(null)_';
      const adm = t.admin_only ? '🔒' : '';
      const cat = t.category ?? '';
      const sk = t.source_kind ?? '';
      const desc = escapeMd((t.description ?? '').slice(0, 220));
      lines.push(`| \`${t.name}\` | ${tier} | ${adm} | ${cat} | ${sk} | ${desc} |`);
    }
    lines.push('');
  }

  // ── 2. Per-tool detail (chrome-extension only — that's what we own) ─────
  lines.push('---');
  lines.push('');
  lines.push('## 2. chrome-extension tool details');
  lines.push('');
  lines.push('Each entry includes the full description + parameter summary so');
  lines.push('the reviewer can spot redundant fields, stale text, or schema gaps.');
  lines.push('Required params are **bold**.');
  lines.push('');

  const ours = (byExecutor.get(EXECUTOR_NAME) ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const t of ours) {
    lines.push(`### \`${t.name}\``);
    lines.push('');
    const otherExecutors = (executorsByTool.get(t.id) ?? []).filter((e) => e !== EXECUTOR_NAME);
    const sharedNote =
      otherExecutors.length > 0
        ? ` · **also bound to:** ${otherExecutors.map((e) => `\`${e}\``).join(', ')}`
        : '';
    lines.push(
      `- **tier:** ${t.tier ?? '_(null)_'}${t.admin_only ? ' · 🔒 admin' : ''} · **category:** ${t.category ?? '?'} · **active:** ${t.is_active ? '✅' : '❌'} · **version:** ${t.version}${sharedNote}`,
    );
    lines.push('');
    lines.push(`> ${escapeMd(t.description ?? '_(no description)_')}`);
    lines.push('');
    lines.push(`**Params:** ${summarizeParams(t.parameters)}`);
    lines.push('');
  }

  // ── 3. Bundles inventory ────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## 3. Bundles (`tool.bundle`)');
  lines.push('');
  lines.push('Every row in `tool.bundle` + its members. Empty bundles are explicitly');
  lines.push('flagged — they advertise themselves to the LLM but resolve to nothing.');
  lines.push('');

  // bundle_id → [member tool_names]
  const membersByBundle = new Map();
  for (const m of members) {
    if (!membersByBundle.has(m.bundle_id)) membersByBundle.set(m.bundle_id, []);
    membersByBundle.get(m.bundle_id).push({
      name: toolIdToName.get(m.tool_id) ?? `(unknown ${m.tool_id})`,
      alias: m.local_alias,
      order: m.sort_order,
    });
  }
  for (const list of membersByBundle.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  bundles.sort((a, b) => a.name.localeCompare(b.name));
  // Heuristic: a "matrx-extend bundle" is one whose members are MOSTLY tools
  // also bound to chrome-extension. Pure-MCP bundles list zero such tools.
  const ourToolIds = new Set(ours.map((t) => t.id));
  const matrxBundles = [];
  const mcpBundles = [];
  for (const b of bundles) {
    const ms = membersByBundle.get(b.id) ?? [];
    const ownByUs = ms.filter((m) => {
      const tid = members.find(
        (x) => x.bundle_id === b.id && (toolIdToName.get(x.tool_id) ?? '') === m.name,
      )?.tool_id;
      return tid ? ourToolIds.has(tid) : false;
    }).length;
    if (ms.length > 0 && ownByUs >= ms.length / 2) matrxBundles.push(b);
    else mcpBundles.push(b);
  }

  lines.push(`### matrx-extend / chrome-extension category bundles (${matrxBundles.length})`);
  lines.push('');
  lines.push('| bundle | active | members | tool names |');
  lines.push('|---|---|---|---|');
  for (const b of matrxBundles) {
    const ms = membersByBundle.get(b.id) ?? [];
    const flag = ms.length === 0 ? '⚠️ **EMPTY**' : '';
    lines.push(
      `| \`${b.name}\` | ${b.is_active ? '✅' : '❌'} | ${ms.length} ${flag} | ${
        ms.length ? ms.map((x) => `\`${x.name}\``).join(', ') : '_(none)_'
      } |`,
    );
  }
  lines.push('');

  lines.push(`### Other bundles (${mcpBundles.length})`);
  lines.push('');
  lines.push('MCP marketplace + any non-chrome-extension surface bundles.');
  lines.push('');
  lines.push('| bundle | members | description |');
  lines.push('|---|---|---|');
  for (const b of mcpBundles) {
    const ms = membersByBundle.get(b.id) ?? [];
    lines.push(
      `| \`${b.name}\` | ${ms.length} | ${escapeMd((b.description ?? '').slice(0, 100))} |`,
    );
  }
  lines.push('');

  // ── 4. Sources-of-truth audit ───────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## 4. Sources-of-truth audit');
  lines.push('');
  lines.push('Where two systems claim authority over the same fact, list the divergence.');
  lines.push('');

  // 4a. CANONICAL_SURFACE vs tool.definition (chrome-extension subset)
  const ourNames = new Set(ours.map((t) => t.name));
  const csOnly = [...canonicalSurface].filter((n) => !ourNames.has(n));
  const dbOnly = [...ourNames].filter((n) => !canonicalSurface.has(n));
  lines.push('### 4a. `CANONICAL_SURFACE` (local) ↔ `tool.definition` (DB, bound to `chrome-extension`)');
  lines.push('');
  lines.push(`- Local CANONICAL_SURFACE entries: **${canonicalSurface.size}**`);
  lines.push(`- DB tools bound to chrome-extension: **${ours.length}**`);
  if (csOnly.length === 0 && dbOnly.length === 0) {
    lines.push('- ✅ Sets match exactly. Drift-check enforces this on every release.');
  } else {
    lines.push(
      `- Local-only (advertised by client but missing in DB): ${csOnly.length ? csOnly.map((n) => `\`${n}\``).join(', ') : '(none)'}`,
    );
    lines.push(
      `- DB-only (in DB but client doesn't advertise): ${dbOnly.length ? dbOnly.map((n) => `\`${n}\``).join(', ') : '(none)'}`,
    );
  }
  lines.push('');

  // 4b. CATEGORY_BY_TOOL (local) vs tool.definition.category (DB)
  lines.push('### 4b. `CATEGORY_BY_TOOL` (local) ↔ `tool.definition.category` (DB)');
  lines.push('');
  const catMismatches = [];
  for (const t of ours) {
    const localCat = categoryByTool[t.name];
    if (localCat && t.category && localCat !== t.category) {
      catMismatches.push({ name: t.name, local: localCat, db: t.category });
    } else if (localCat && !t.category) {
      catMismatches.push({ name: t.name, local: localCat, db: '(null)' });
    } else if (!localCat && t.category) {
      catMismatches.push({ name: t.name, local: '(absent)', db: t.category });
    }
  }
  if (catMismatches.length === 0) {
    lines.push('- ✅ All category assignments match.');
  } else {
    lines.push('| tool | local | DB |');
    lines.push('|---|---|---|');
    for (const m of catMismatches) lines.push(`| \`${m.name}\` | ${m.local} | ${m.db} |`);
  }
  lines.push('');

  // 4c. Local surface_bundles (from catalog) vs local CANONICAL_SURFACE
  lines.push('### 4c. Per-handler `surface_bundles` vs `CANONICAL_SURFACE` membership');
  lines.push('');
  lines.push('Each `ToolHandler.surface_bundles` declares which bundles (assistant /');
  lines.push('pilot / pilot+privileged) it ships with. CANONICAL_SURFACE is the set');
  lines.push('actually emitted to the LLM. These should agree.');
  lines.push('');
  const localTools = catalog.tools ?? [];
  const advertisedByHandler = localTools.filter((t) => (t.surface_bundles ?? []).length > 0);
  const noBundleHandlers = localTools.filter((t) => (t.surface_bundles ?? []).length === 0);
  lines.push(`- Local handlers with non-empty surface_bundles: **${advertisedByHandler.length}**`);
  lines.push(
    `- Local handlers with empty surface_bundles: **${noBundleHandlers.length}** ${noBundleHandlers.length === 0 ? '✅' : '⚠️'}`,
  );
  const inCSnotAdvertised = [...canonicalSurface].filter((n) => {
    const t = localByName.get(n);
    return t && (t.surface_bundles ?? []).length === 0;
  });
  const advertisedNotCS = advertisedByHandler.filter((t) => !canonicalSurface.has(t.name));
  if (inCSnotAdvertised.length === 0 && advertisedNotCS.length === 0) {
    lines.push('- ✅ CANONICAL_SURFACE and surface_bundles agree on the advertised set.');
  } else {
    if (inCSnotAdvertised.length)
      lines.push(
        `- ⚠️ In CANONICAL_SURFACE but handler has empty surface_bundles: ${inCSnotAdvertised.map((n) => `\`${n}\``).join(', ')}`,
      );
    if (advertisedNotCS.length)
      lines.push(
        `- ⚠️ Handler advertises bundle but not in CANONICAL_SURFACE: ${advertisedNotCS.map((t) => `\`${t.name}\``).join(', ')}`,
      );
  }
  lines.push('');

  // 4d. DB tool.bundle vs local categories
  lines.push('### 4d. DB `tool.bundle` (chrome-extension) ↔ local categories');
  lines.push('');
  const localCatSet = new Set(Object.values(categoryByTool));
  const dbBundleNames = new Set(matrxBundles.map((b) => b.name));
  const bundleOnly = [...dbBundleNames].filter((n) => !localCatSet.has(n));
  const localOnly = [...localCatSet].filter((n) => !dbBundleNames.has(n));
  lines.push(`- DB chrome-extension bundles: **${dbBundleNames.size}**`);
  lines.push(`- Local categories: **${localCatSet.size}**`);
  if (bundleOnly.length === 0 && localOnly.length === 0) {
    lines.push('- ✅ Bundle/category names align.');
  } else {
    if (bundleOnly.length)
      lines.push(`- DB-only bundles: ${bundleOnly.map((n) => `\`${n}\``).join(', ')}`);
    if (localOnly.length)
      lines.push(`- Local-only categories: ${localOnly.map((n) => `\`${n}\``).join(', ')}`);
  }
  lines.push('');

  // 4e. Empty chrome-extension bundles in DB
  const emptyBundles = matrxBundles.filter((b) => (membersByBundle.get(b.id) ?? []).length === 0);
  lines.push('### 4e. Empty `tool.bundle` rows (DB advertises but resolves to nothing)');
  lines.push('');
  if (emptyBundles.length === 0) {
    lines.push('- ✅ No empty chrome-extension bundles.');
  } else {
    lines.push(
      `- ⚠️ **${emptyBundles.length} chrome-extension bundles have ZERO members in \`tool.bundle_member\`:**`,
    );
    lines.push('');
    lines.push(emptyBundles.map((b) => `  - \`${b.name}\``).join('\n'));
    lines.push('');
    lines.push('  These rows make `load_browser_tools({category: X})` look like a');
    lines.push('  legitimate option to the LLM but return an empty list at runtime.');
    lines.push('  Either populate `tool.bundle_member` OR set `is_active = false` so');
    lines.push('  the discovery handler stops advertising them.');
  }
  lines.push('');

  // ── 5. Suggested next steps ─────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push('## 5. Suggested review focus');
  lines.push('');
  lines.push(
    '- **Pick descriptions to tighten** — Section 2 has every description verbatim. Look for context bloat, stale field references, or generic text.',
  );
  lines.push(
    '- **Confirm tier + admin_only** — Tier drives the approval UX; admin_only gates visibility. Eyeball any tool where the surface looks risky for the tier shown.',
  );
  lines.push(
    '- **Decide bundle strategy** — Section 4d/4e show DB bundles drifting from local categories. Three options: deprecate `tool.bundle` for chrome-extension (use local categories only), populate the DB bundles to match local, or split-domain (DB bundles for MCP marketplace, local categories for browser tools).',
  );
  lines.push(
    '- **Hunt missing parameters** — Section 2 shows the param summary. Look for tools where the LLM has no signal about what to pass (no required fields, generic types).',
  );
  lines.push('');

  // ── write file ──────────────────────────────────────────────────────────
  const outPath = resolve(ROOT, 'types/tool-db-dump.md');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join('\n'));
  console.log(`✓ wrote ${allTools.length} tools + ${bundles.length} bundles to ${outPath}`);
  console.log(`  open: ${outPath}`);
}

main().catch((err) => {
  console.error('dump-tool-db-to-md: unexpected error');
  console.error(err);
  process.exit(2);
});
