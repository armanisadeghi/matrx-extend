#!/usr/bin/env tsx
/**
 * Tool-drift reporter — the matrx-extend half of the unified code↔DB system
 * (one shared spec across aidream, matrx-extend, matrx-frontend; see
 * docs/TOOL_SOURCE_OF_TRUTH.md, "what match means").
 *
 * The DATABASE (`public.tl_def`, `source_app='matrx-extend'`) is the single
 * source of truth. This reporter proves the ACTUAL CODE matches it: it
 * serializes the REAL Zod `argsSchema` of every live handler — the exact object
 * the dispatcher validates against at src/lib/tools/dispatch.ts — and diffs it
 * against tl_def. There is NO intermediate file: the schema we check is the
 * schema that runs.
 *
 * What it checks per tool (the shared spec): identity (name), tier, admin_only,
 * category, and the argument set — for every field: presence, type,
 * required-ness, enum members (incl. one-sided), and default. Plus the
 * matrx-extend surface wiring: an active tl_executor row for
 * surface='matrx-extend.browser' (this binding IS the location/ownership proof
 * — function_path is N/A for a browser executor) and a tl_def_surface gate for
 * at least one chrome-extension/{assistant,pilot}. Descriptions are NOT checked
 * — they are not code; they live only in the DB (Rule 4).
 *
 *   tsx scripts/check-tool-db-drift.ts   (pnpm catalog:tools:drift)
 *
 * LOUD + NON-BLOCKING (Rule 6): it screams a big red banner on drift but never
 * stops the world. It is wired into release.sh as a non-fatal step and into
 * prebuild/prezip with `|| true`; no env var gates it. It exits non-zero on
 * drift purely as a SIGNAL for those callers — none hard-gate on it. "Couldn't
 * run" (missing creds / DB unreachable) is NOT drift: it warns and exits 0.
 * When drift fires: the DB is the source of truth, so bring the handler's Zod
 * to match tl_def, or change the DB first (admin API / migration) then match
 * code. Never push code→DB silently (Rule 7).
 */
import process from 'node:process';
import { CANONICAL_SURFACE } from '../src/lib/tools/categories';
import { buildToolCatalogManifest } from '../src/lib/tools/catalog';
import { fetchPublicJson, loadSupabaseEnv } from './_supabase-rest';

interface LocalTool {
  name: string;
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

async function fetchDbRows(url: string, key: string): Promise<DbToolRow[]> {
  return fetchPublicJson<DbToolRow[]>(
    url,
    key,
    'tl_def?source_app=eq.matrx-extend&select=id,name,description,parameters,tier,admin_only,privileged,is_active,category&order=name.asc',
  );
}

async function fetchExecutors(url: string, key: string): Promise<DbExecutorRow[]> {
  return fetchPublicJson<DbExecutorRow[]>(
    url,
    key,
    'tl_executor?surface=eq.matrx-extend.browser&select=tool_id,surface,is_active',
  );
}

async function fetchSurfaceGates(url: string, key: string): Promise<DbSurfaceGateRow[]> {
  return fetchPublicJson<DbSurfaceGateRow[]>(
    url,
    key,
    'tl_def_surface?or=(surface_name.eq.chrome-extension/assistant,surface_name.eq.chrome-extension/pilot)&select=tool_id,surface_name',
  );
}

function loadLiveSchemas(): LocalTool[] {
  // Serialize the REAL Zod argsSchema of every live handler — the exact object
  // the dispatcher validates against — into the comparable shape. No file in
  // between: the schema we check is the schema that actually runs.
  return buildToolCatalogManifest().tools.map((t) => ({
    name: t.name,
    tier: t.tier,
    category: t.category,
    admin_only: t.admin_only,
    input_schema: t.input_schema as unknown as LocalTool['input_schema'],
  }));
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

  // Descriptions are intentionally NOT compared — they are not code; they live
  // only in the DB (tl_def.description). The gate checks the structural contract
  // the runtime enforces: fields, types, required, enums, tier, admin_only.

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
  // `$`-prefixed keys ($variants, …) are contract metadata, NOT tool parameters.
  const dbProps = Object.fromEntries(
    Object.entries(db.parameters ?? {}).filter(([k]) => !k.startsWith('$')),
  );
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

  // Per-field enum + type + default comparison (for fields present in both)
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

    // Default value — part of the shared "what match means" spec. A default in
    // one side but not the other, or differing defaults, is real drift: the
    // model and the dispatcher disagree on what an omitted field becomes.
    const lDef = (l as { default?: unknown }).default;
    const dDef = (d as { default?: unknown }).default;
    const lHasDef = lDef !== undefined;
    const dHasDef = dDef !== undefined;
    if (lHasDef !== dHasDef) {
      issues.push(
        `${field}: default ${lHasDef ? `only in local (${JSON.stringify(lDef)})` : `only in DB (${JSON.stringify(dDef)})`}`,
      );
    } else if (lHasDef && dHasDef && JSON.stringify(lDef) !== JSON.stringify(dDef)) {
      issues.push(
        `${field}: default differs (local=${JSON.stringify(lDef)}, db=${JSON.stringify(dDef)})`,
      );
    }
  }

  return issues;
}

async function main(): Promise<void> {
  // No env var gates this (Rule 6). Missing creds is "cannot verify", NOT drift:
  // warn loudly and exit 0 so it never blocks a build or boot.
  const env = loadSupabaseEnv();
  if (!env) {
    console.warn(
      'drift-check: Supabase creds not found — SKIPPING (cannot verify without DB ' +
        'access). This is NOT drift; a build/CI with creds present runs the full check.',
    );
    process.exit(0);
  }
  const { url, key } = env;
  const localAll = loadLiveSchemas();
  let dbRows: DbToolRow[];
  let executors: DbExecutorRow[];
  let gates: DbSurfaceGateRow[];
  try {
    [dbRows, executors, gates] = await Promise.all([
      fetchDbRows(url, key),
      fetchExecutors(url, key),
      fetchSurfaceGates(url, key),
    ]);
  } catch (err) {
    // "Couldn't run" (DB unreachable / RLS / network) is NOT drift — never block.
    console.warn(
      `drift-check: could not read the DB — SKIPPING (this is NOT drift). ${(err as Error).message}`,
    );
    process.exit(0);
  }

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
  console.log(`${DIM}Fix path — the DATABASE (public.tl_def) is the source of truth:${RESET}`);
  console.log(`${DIM}  - tl_def is the truth (what the LLM sees).${RESET}`);
  console.log(`${DIM}  - Bring the handler's real Zod (src/lib/tools/handlers/*.ts) to match tl_def.${RESET}`);
  console.log(`${DIM}  - If the DB itself is wrong, change it (admin API / migration), then match code.${RESET}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('drift-check: unexpected error');
  console.error(err);
  process.exit(2);
});
