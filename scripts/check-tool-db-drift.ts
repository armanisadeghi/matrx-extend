#!/usr/bin/env tsx
/**
 * Diff the local tool catalog (types/tool-catalog.json) against the
 * `public.tl_def` rows in Supabase that have `source_app = 'matrx-extend'`.
 *
 * The local catalog is the source of truth — it's what actually executes
 * inside the extension (Zod schemas in src/lib/tools/handlers/*.ts gated
 * by the dispatcher at src/lib/tools/dispatch.ts). When the DB drifts,
 * the LLM sees one shape and the dispatcher accepts another — the model
 * gets blocked by a validation layer it can't see in its own tool
 * definition. This is exactly how `tabs.action='get_info'` happened.
 *
 *   pnpm catalog:tools          # regenerate the local catalog first
 *   tsx scripts/check-tool-db-drift.ts
 *
 * Exits 0 when everything matches, 1 when drift is found.
 * Run from release.sh as a warning (don't block the ship — manual fixes
 * via Supabase MCP / admin API will catch up over time).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SURFACE } from '../src/lib/tools/categories';

interface LocalTool {
  name: string;
  description: string;
  tier: string;
  category?: string;
  admin_only?: boolean;
  input_schema: {
    type: 'object';
    properties: Record<string, { type?: string | string[]; enum?: unknown[]; [k: string]: unknown }>;
    required?: string[];
  };
}

interface DbToolRow {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, { type?: string | string[]; enum?: unknown[]; required?: boolean; [k: string]: unknown }> | null;
  tier: string | null;
  admin_only: boolean | null;
  privileged: boolean | null;
  is_active: boolean | null;
  category: string | null;
}

interface DbExecutorRow {
  tool_id: string;
  surface: string;
  is_active: boolean;
}

interface DbSurfaceGateRow {
  tool_id: string;
  surface_name: string;
}

interface Drift {
  name: string;
  issues: string[];
}

/**
 * Legacy surface prefix. Some matrx-extend tools (Chrome-extension-exclusive
 * ones: CDP, cookies, bookmarks, history, demos, guidance) still carry the
 * `matrx-extend:` prefix in tl_def.name. UI-first / Playwright-capable tools
 * (update_plan, tasks, user_todos, user, request_user_takeover, scratchpad,
 * and the rest in tiers 1+2) live at bare names in the global namespace.
 * `normalizeName` strips the prefix when present so the comparator works for
 * both cases without forking the loop.
 */
const DB_PREFIX = 'matrx-extend:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(): { url: string; key: string } {
  // Prefer process.env; otherwise grep .env.production / .env.development
  let url = process.env.SUPABASE_URL ?? process.env.WXT_SUPABASE_URL ?? '';
  let key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.WXT_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    '';

  if (!url || !key) {
    for (const f of ['.env.production.local', '.env.production', '.env.development.local', '.env.development', '.env']) {
      const p = resolve(ROOT, f);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
        if (!m) continue;
        const [, k, raw] = m;
        const v = (raw ?? '').replace(/^['"]|['"]$/g, '');
        if (!url && (k === 'WXT_SUPABASE_URL' || k === 'SUPABASE_URL')) url = v;
        if (!key && (k === 'WXT_SUPABASE_PUBLISHABLE_KEY' || k === 'SUPABASE_PUBLISHABLE_KEY' || k === 'SUPABASE_ANON_KEY')) key = v;
      }
      if (url && key) break;
    }
  }

  if (!url || !key) {
    console.error('drift-check: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not found in env or .env.* files');
    process.exit(2);
  }
  return { url, key };
}

async function fetchJson<T>(url: string, key: string, path: string): Promise<T> {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${path}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      // Custom Supabase proxy at db.matrxserver.com defaults to schema 'api';
      // these tables live in 'public', so request it explicitly.
      'Accept-Profile': 'public',
    },
  });
  if (!res.ok) {
    console.error(`drift-check: Supabase fetch failed (${res.status}) on ${path}: ${await res.text()}`);
    process.exit(2);
  }
  return (await res.json()) as T;
}

async function fetchDbRows(url: string, key: string): Promise<DbToolRow[]> {
  return fetchJson<DbToolRow[]>(
    url,
    key,
    'tl_def?source_app=eq.matrx-extend&select=id,name,description,parameters,tier,admin_only,privileged,is_active,category&order=name.asc',
  );
}

async function fetchExecutors(url: string, key: string): Promise<DbExecutorRow[]> {
  return fetchJson<DbExecutorRow[]>(
    url,
    key,
    'tl_executor?surface=eq.matrx-extend.browser&select=tool_id,surface,is_active',
  );
}

async function fetchSurfaceGates(url: string, key: string): Promise<DbSurfaceGateRow[]> {
  return fetchJson<DbSurfaceGateRow[]>(
    url,
    key,
    'tl_def_surface?or=(surface_name.eq.chrome-extension/assistant,surface_name.eq.chrome-extension/pilot)&select=tool_id,surface_name',
  );
}

function loadLocalCatalog(): LocalTool[] {
  const path = resolve(ROOT, 'types/tool-catalog.json');
  if (!existsSync(path)) {
    console.error(`drift-check: ${path} not found — run 'pnpm catalog:tools' first.`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { tools: LocalTool[] };
  return manifest.tools;
}

function normalizeName(dbName: string): string {
  return dbName.startsWith(DB_PREFIX) ? dbName.slice(DB_PREFIX.length) : dbName;
}

function asSet<T>(xs: T[] | undefined | null): Set<T> {
  return new Set(xs ?? []);
}

function setDiff<T>(a: Set<T>, b: Set<T>): { onlyA: T[]; onlyB: T[] } {
  const onlyA: T[] = [];
  const onlyB: T[] = [];
  for (const x of a) if (!b.has(x)) onlyA.push(x);
  for (const x of b) if (!a.has(x)) onlyB.push(x);
  return { onlyA, onlyB };
}

function compareEnums(localEnum: unknown[] | undefined, dbEnum: unknown[] | undefined): string | null {
  if (!localEnum && !dbEnum) return null;
  if (!localEnum) return 'local has no enum, DB has one';
  if (!dbEnum) return 'DB has no enum, local has one';
  const a = asSet(localEnum.map(String));
  const b = asSet(dbEnum.map(String));
  const { onlyA, onlyB } = setDiff(a, b);
  if (!onlyA.length && !onlyB.length) return null;
  const parts: string[] = [];
  if (onlyA.length) parts.push(`only in local: ${JSON.stringify(onlyA)}`);
  if (onlyB.length) parts.push(`only in DB: ${JSON.stringify(onlyB)}`);
  return `enum drift — ${parts.join('; ')}`;
}

function compareTool(local: LocalTool, db: DbToolRow): string[] {
  const issues: string[] = [];

  if ((local.description ?? '').trim() !== (db.description ?? '').trim()) {
    issues.push('description differs');
  }

  if (local.tier !== db.tier) {
    issues.push(`tier differs (local=${local.tier}, db=${db.tier})`);
  }

  if (!!local.admin_only !== !!db.admin_only) {
    issues.push(`admin_only differs (local=${!!local.admin_only}, db=${!!db.admin_only})`);
  }

  // Category is UX-only per TOOL_ROUTING_RULES.md (doesn't affect routing)
  // but keeping it in sync prevents Tools-tab confusion + supports the
  // discovery-helper category model.
  if (local.category && db.category && local.category !== db.category) {
    issues.push(`category differs (local=${local.category}, db=${db.category})`);
  } else if (local.category && !db.category) {
    issues.push(`category missing in DB (local=${local.category})`);
  }

  // Parameter shape comparison
  const localProps = local.input_schema?.properties ?? {};
  const dbProps = db.parameters ?? {};
  const localRequired = new Set(local.input_schema?.required ?? []);
  const dbRequired = new Set(
    Object.entries(dbProps)
      .filter(([, def]) => def && (def as { required?: boolean }).required === true)
      .map(([k]) => k),
  );

  const localFields = new Set(Object.keys(localProps));
  const dbFields = new Set(Object.keys(dbProps));
  const { onlyA: localOnlyFields, onlyB: dbOnlyFields } = setDiff(localFields, dbFields);

  if (localOnlyFields.length) issues.push(`fields only in local: ${localOnlyFields.join(', ')}`);
  if (dbOnlyFields.length) issues.push(`fields only in DB: ${dbOnlyFields.join(', ')}`);

  const reqDiff = setDiff(localRequired, dbRequired);
  if (reqDiff.onlyA.length) issues.push(`required only in local: ${reqDiff.onlyA.join(', ')}`);
  if (reqDiff.onlyB.length) issues.push(`required only in DB: ${reqDiff.onlyB.join(', ')}`);

  // Per-field enum + type comparison (for fields present in both)
  for (const field of localFields) {
    if (!dbFields.has(field)) continue;
    const l = localProps[field] ?? {};
    const d = dbProps[field] ?? {};
    const enumDrift = compareEnums(l.enum, d.enum);
    if (enumDrift) issues.push(`${field}: ${enumDrift}`);

    const lType = Array.isArray(l.type) ? [...l.type].sort().join('|') : l.type;
    const dType = Array.isArray(d.type) ? [...d.type].sort().join('|') : d.type;
    if (lType && dType && lType !== dType) {
      issues.push(`${field}: type differs (local=${lType}, db=${dType})`);
    }
  }

  return issues;
}

async function main(): Promise<void> {
  const { url, key } = loadEnv();
  const localAll = loadLocalCatalog();
  const [dbRows, executors, gates] = await Promise.all([
    fetchDbRows(url, key),
    fetchExecutors(url, key),
    fetchSurfaceGates(url, key),
  ]);

  // Only compare tools the LLM is meant to see. CANONICAL_SURFACE
  // (src/lib/tools/categories.ts) is the authoritative list of advertised
  // names. Everything else is an "absorbed" handler that lives behind a
  // mega-tool router (e.g. take_screenshot behind `computer`) and has no
  // business being in tl_def.
  const local = localAll.filter((t) => CANONICAL_SURFACE.has(t.name));
  const localByName = new Map(local.map((t) => [t.name, t]));
  const dbByName = new Map(dbRows.map((r) => [normalizeName(r.name), r]));
  const dbById = new Map(dbRows.map((r) => [r.id, r]));

  // Executor bindings → tool ids that DO have a matrx-extend.browser binding
  const boundIds = new Set(executors.filter((e) => e.is_active).map((e) => e.tool_id));

  // Surface gates → which tools are gated on which client-extension surface
  const gatesByTool = new Map<string, Set<string>>();
  for (const g of gates) {
    if (!gatesByTool.has(g.tool_id)) gatesByTool.set(g.tool_id, new Set());
    gatesByTool.get(g.tool_id)!.add(g.surface_name);
  }

  const drifts: Drift[] = [];
  const localOnly: string[] = [];
  const dbOnly: string[] = [];
  const dbInactive: string[] = [];
  const missingExecutor: string[] = [];
  const missingGate: string[] = [];
  const orphanGate: string[] = [];

  for (const [name, l] of localByName) {
    const d = dbByName.get(name);
    if (!d) {
      localOnly.push(name);
      continue;
    }
    if (d.is_active === false) dbInactive.push(name);
    const issues = compareTool(l, d);
    if (issues.length) drifts.push({ name, issues });

    // Executor binding check — every advertised tool MUST have a row in
    // tl_executor for the matrx-extend.browser surface, else the server
    // doesn't know who runs it.
    if (!boundIds.has(d.id)) missingExecutor.push(name);

    // Surface gate check — every advertised tool MUST be gated for at
    // least one chrome-extension/* surface (assistant or pilot), else
    // the discovery handler can't surface it to either chat path.
    const surfaces = gatesByTool.get(d.id);
    if (!surfaces || surfaces.size === 0) missingGate.push(name);
  }

  for (const [name] of dbByName) {
    if (!localByName.has(name)) dbOnly.push(name);
  }

  // Orphan gates — gating rows pointing at DB ids that don't exist in
  // matrx-extend tl_def. Indicates a tool was renamed/deleted without
  // cleaning up its gates.
  for (const g of gates) {
    if (!dbById.has(g.tool_id)) orphanGate.push(`${g.surface_name}/${g.tool_id.slice(0, 8)}`);
  }

  const totalLocal = localByName.size;
  const totalDb = dbByName.size;
  const totalProblems =
    localOnly.length +
    dbOnly.length +
    drifts.length +
    missingExecutor.length +
    missingGate.length +
    orphanGate.length;

  // ── ANSI styling — bright red + bold + reverse for max screaming ─────────
  const isTTY = process.stdout.isTTY && process.env.NO_COLOR !== '1';
  const RED = isTTY ? '\x1b[1;91m' : '';
  const RED_BG = isTTY ? '\x1b[1;97;41m' : '';
  const YELLOW = isTTY ? '\x1b[1;93m' : '';
  const DIM = isTTY ? '\x1b[2m' : '';
  const RESET = isTTY ? '\x1b[0m' : '';

  console.log(`Tool-DB drift check v2 — local catalog ↔ public.{tl_def, tl_executor, tl_def_surface}`);
  console.log(`  local catalog tools (advertised): ${totalLocal}  ${DIM}(${localAll.length} total; absorbed handlers excluded via CANONICAL_SURFACE)${RESET}`);
  console.log(`  DB tl_def rows:                   ${totalDb}`);
  console.log(`  DB tl_executor rows (active):     ${executors.filter((e) => e.is_active).length}`);
  console.log(`  DB tl_def_surface gates:          ${gates.length}`);
  console.log('');

  if (totalProblems === 0) {
    console.log('\x1b[1;92m✓ No drift detected.\x1b[0m');
    process.exit(0);
  }

  // ── BIG RED BANNER ───────────────────────────────────────────────────────
  const bar = '████████████████████████████████████████████████████████████████████';
  console.log(`${RED_BG}${bar}${RESET}`);
  console.log(`${RED_BG}██${RESET}                                                                ${RED_BG}██${RESET}`);
  console.log(`${RED_BG}██${RESET}   ${RED}⚠  TOOL-CATALOG / DB SCHEMA DRIFT DETECTED  ⚠${RESET}              ${RED_BG}██${RESET}`);
  console.log(`${RED_BG}██${RESET}                                                                ${RED_BG}██${RESET}`);
  console.log(`${RED_BG}██${RESET}   ${RED}${totalProblems} problem(s) found across ${drifts.length + localOnly.length} tool(s).${RESET}${' '.repeat(Math.max(0, 28 - String(totalProblems).length - String(drifts.length + localOnly.length).length))}${RED_BG}██${RESET}`);
  console.log(`${RED_BG}██${RESET}   ${RED}The LLM sees one schema; the dispatcher accepts another.${RESET}      ${RED_BG}██${RESET}`);
  console.log(`${RED_BG}██${RESET}                                                                ${RED_BG}██${RESET}`);
  console.log(`${RED_BG}${bar}${RESET}`);
  console.log('');

  if (localOnly.length) {
    console.log(`${RED}✗ Local-only (${localOnly.length}) — exist in code but MISSING in tl_def:${RESET}`);
    for (const n of localOnly) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('');
  }

  if (dbOnly.length) {
    console.log(`${RED}✗ DB-only (${dbOnly.length}) — exist in tl_def but MISSING in code:${RESET}`);
    for (const n of dbOnly) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('');
  }

  if (dbInactive.length) {
    console.log(`${YELLOW}⚠ DB-inactive (${dbInactive.length}) — in tl_def but is_active=false:${RESET}`);
    for (const n of dbInactive) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('');
  }

  if (drifts.length) {
    console.log(`${RED}✗ Schema drift in ${drifts.length} tool(s):${RESET}`);
    for (const d of drifts) {
      console.log(`  ${RED}•${RESET} ${d.name}`);
      for (const issue of d.issues) console.log(`      ${DIM}-${RESET} ${issue}`);
    }
    console.log('');
  }

  if (missingExecutor.length) {
    console.log(`${RED}✗ Missing executor binding (${missingExecutor.length}) — advertised but no tl_executor row for surface='matrx-extend.browser':${RESET}`);
    for (const n of missingExecutor) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('  Server cannot route these calls — they will fail with "no executor".');
    console.log('');
  }

  if (missingGate.length) {
    console.log(`${RED}✗ Missing surface gate (${missingGate.length}) — no tl_def_surface row for chrome-extension/{assistant,pilot}:${RESET}`);
    for (const n of missingGate) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('  Discovery handler will not surface these to the LLM on either chat path.');
    console.log('');
  }

  if (orphanGate.length) {
    console.log(`${YELLOW}⚠ Orphan surface gates (${orphanGate.length}) — gates pointing at deleted/renamed tools:${RESET}`);
    for (const n of orphanGate) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('  Clean these from tl_def_surface (DELETE WHERE tool_id NOT IN tl_def).');
    console.log('');
  }

  // ── REPEAT THE BANNER SO IT'S THE LAST THING ─────────────────────────────
  console.log(`${RED_BG}${bar}${RESET}`);
  console.log(`${RED_BG}██${RESET}   ${RED}DRIFT: ${totalProblems} problem(s). Fix tl_def or local handlers.${RESET}${' '.repeat(Math.max(0, 22 - String(totalProblems).length))}${RED_BG}██${RESET}`);
  console.log(`${RED_BG}${bar}${RESET}`);
  console.log('');
  console.log(`${DIM}Fix path:${RESET}`);
  console.log(`${DIM}  - tl_def (Supabase public.tl_def) is what the LLM sees.${RESET}`);
  console.log(`${DIM}  - src/lib/tools/handlers/*.ts (Zod) is what the dispatcher accepts.${RESET}`);
  console.log(`${DIM}  - Use the Supabase MCP / admin API to reconcile tl_def with code.${RESET}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('drift-check: unexpected error');
  console.error(err);
  process.exit(2);
});
