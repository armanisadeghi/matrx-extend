#!/usr/bin/env tsx
/**
 * Tool-drift reporter — the matrx-extend half of the unified code↔DB system
 * (one shared spec across aidream, matrx-extend, matrx-frontend; see
 * docs/TOOL_SOURCE_OF_TRUTH.md, "what match means").
 *
 * The DATABASE is the single source of truth. This reporter proves the ACTUAL
 * CODE matches it: it serializes the REAL Zod `argsSchema` of every live
 * handler — the exact object the dispatcher validates against at
 * src/lib/tools/dispatch.ts — and diffs it against `tool.definition`. There
 * is NO intermediate file: the schema we check is the schema that runs.
 *
 * Schema (post 2026-06 schema canonicalization — tables moved from `public`
 * to the `tool` schema):
 *
 *   - `tool.definition`      — name, description, parameters, tier,
 *                               admin_only, category, is_active, source_kind.
 *                               No `source_app` / `function_path`; ownership
 *                               lives on the binding row.
 *   - `tool.binding`         — pure (tool_id, executor_name, is_active) M2M.
 *                               We claim a tool by binding it to the
 *                               `chrome-extension` executor.
 *   - `tool.surface_defaults`— per-surface include/exclude arrays. We confirm
 *                               every advertised tool appears in
 *                               `always_include_tools` for at least one of
 *                               `chrome-extension/{assistant,pilot}` so the
 *                               resolver hands it to the model.
 *
 * What it checks per tool (the shared spec): identity (name), tier, admin_only,
 * category, and the argument set — for every field: presence, type,
 * required-ness, enum members (incl. one-sided), and default. Plus the
 * matrx-extend wiring: an active `tool.binding` row for
 * `executor_name='chrome-extension'` and inclusion in
 * `tool.surface_defaults.always_include_tools` for at least one
 * chrome-extension surface. Descriptions are NOT checked —
 * they are not code; they live only in the DB (Rule 4).
 *
 *   tsx scripts/check-tool-db-drift.ts   (pnpm catalog:tools:drift)
 *
 * LOUD + NON-BLOCKING (Rule 6): it screams a big red banner on drift but never
 * stops the world. It is wired into release.sh as a non-fatal step and into
 * prebuild/prezip with `|| true`; no env var gates it. It exits non-zero on
 * drift purely as a SIGNAL for those callers — none hard-gate on it. "Couldn't
 * run" (missing creds / DB unreachable) is NOT drift: it warns and exits 0.
 * When drift fires: the DB is the source of truth, so bring the handler's Zod
 * to match `tool.definition`, or change the DB first (admin API / migration)
 * then match code. Never push code→DB silently (Rule 7).
 */
import process from 'node:process';
import { buildToolCatalogManifest } from '../src/lib/tools/catalog';
import { CANONICAL_SURFACE } from '../src/lib/tools/categories';
import { fetchPublicJson, loadSupabaseEnv } from './_supabase-rest';

interface LocalTool {
  name: string;
  tier: string;
  category?: string;
  admin_only?: boolean;
  input_schema: {
    type: 'object';
    properties: Record<
      string,
      { type?: string | string[]; enum?: unknown[]; [k: string]: unknown }
    >;
    required?: string[];
  };
}

interface DbToolRow {
  id: string;
  name: string;
  description: string;
  parameters: Record<
    string,
    { type?: string | string[]; enum?: unknown[]; required?: boolean; [k: string]: unknown }
  > | null;
  tier: string | null;
  admin_only: boolean | null;
  is_active: boolean | null;
  category: string | null;
  source_kind: string | null;
}

interface DbBindingRow {
  tool_id: string;
  executor_name: string;
  is_active: boolean;
}

interface DbSurfaceDefaultsRow {
  surface_name: string;
  always_include_tools: string[] | null;
  never_include_tools: string[] | null;
}

interface Drift {
  name: string;
  issues: string[];
}

const EXECUTOR_NAME = 'chrome-extension';
const ASSISTANT_SURFACE = 'chrome-extension/assistant';
const PILOT_SURFACE = 'chrome-extension/pilot';

/**
 * Fetch every `tool_def` row that is bound to the `chrome-extension`
 * executor (or any sub-executor like `chrome-extension.pilot`). This is
 * the new ownership query — replaces the old `source_app='matrx-extend'`
 * filter. Two HTTP calls because PostgREST's embedded filter
 * `tool_binding.executor_name=eq.chrome-extension` only filters the JOINED
 * rows, not the parent `tool_def` rows, so we'd still pull every tool. A
 * two-step (bindings → ids → defs) is precise and small (~50 ids).
 */
async function fetchOwnedTools(
  url: string,
  key: string,
): Promise<{ defs: DbToolRow[]; bindings: DbBindingRow[] }> {
  // Post 2026-06 canonicalization: tool_binding → tool.binding, tool_def → tool.definition
  const bindings = await fetchPublicJson<DbBindingRow[]>(
    url,
    key,
    `binding?or=(executor_name.eq.${EXECUTOR_NAME},executor_name.like.${EXECUTOR_NAME}.*)&select=tool_id,executor_name,is_active`,
    'tool',
  );
  const ids = [...new Set(bindings.filter((b) => b.is_active).map((b) => b.tool_id))];
  if (ids.length === 0) return { defs: [], bindings };
  const inList = `(${ids.map((i) => `"${i}"`).join(',')})`;
  const defs = await fetchPublicJson<DbToolRow[]>(
    url,
    key,
    `definition?id=in.${inList}&select=id,name,description,parameters,tier,admin_only,is_active,category,source_kind&order=name.asc`,
    'tool',
  );
  return { defs, bindings };
}

/**
 * Fetch `tool_surface_defaults` rows for the chrome-extension assistant +
 * pilot surfaces. The discovery handler reads `always_include_tools` to
 * decide what to advertise — missing here means the resolver never
 * surfaces the tool, even if there IS a binding.
 */
async function fetchSurfaceDefaults(url: string, key: string): Promise<DbSurfaceDefaultsRow[]> {
  // Post 2026-06 canonicalization: tool_surface_defaults → tool.surface_defaults
  return fetchPublicJson<DbSurfaceDefaultsRow[]>(
    url,
    key,
    `surface_defaults?or=(surface_name.eq.${encodeURIComponent(ASSISTANT_SURFACE)},surface_name.eq.${encodeURIComponent(PILOT_SURFACE)})&select=surface_name,always_include_tools,never_include_tools`,
    'tool',
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

function compareEnums(
  localEnum: unknown[] | undefined,
  dbEnum: unknown[] | undefined,
): string | null {
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
  // only in the DB (tool_def.description). The gate checks the structural
  // contract the runtime enforces: fields, types, required, enums, tier,
  // admin_only.

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

/**
 * --strict: "cannot verify" becomes a FAILURE instead of a skip. The default
 * mode deliberately exits 0 when creds are missing or the DB is unreachable
 * ("couldn't run is not drift"), which is right for dev builds — but it also
 * means a release pipeline without creds silently passes a drifted catalog.
 * Release gates run `pnpm catalog:tools:drift:strict` so absence of
 * verification is loud. Exit codes: 0 clean, 1 drift, 3 could-not-verify
 * (strict only). See docs/AUDIT_2026_06_10.md P1-25.
 */
const STRICT = process.argv.includes('--strict');

async function main(): Promise<void> {
  // No env var gates this (Rule 6). Missing creds is "cannot verify", NOT drift:
  // warn loudly and exit 0 so it never blocks a build or boot. (--strict
  // flips that to a hard failure — releases must actually verify.)
  const env = loadSupabaseEnv();
  if (!env) {
    if (STRICT) {
      console.error(
        'drift-check (--strict): Supabase creds not found — FAILING. A release ' +
          'gate must actually verify against the DB; run with creds present.',
      );
      process.exit(3);
    }
    console.warn(
      'drift-check: Supabase creds not found — SKIPPING (cannot verify without DB ' +
        'access). This is NOT drift; a build/CI with creds present runs the full check.',
    );
    process.exit(0);
  }
  const { url, key } = env;
  const localAll = loadLiveSchemas();
  let dbDefs: DbToolRow[];
  let dbBindings: DbBindingRow[];
  let dbSurfaces: DbSurfaceDefaultsRow[];
  try {
    const [owned, surfaces] = await Promise.all([
      fetchOwnedTools(url, key),
      fetchSurfaceDefaults(url, key),
    ]);
    dbDefs = owned.defs;
    dbBindings = owned.bindings;
    dbSurfaces = surfaces;
  } catch (err) {
    // "Couldn't run" (DB unreachable / RLS / network) is NOT drift — never
    // block a dev build. Strict (release) mode fails: an unverified release
    // is exactly what the gate exists to prevent.
    if (STRICT) {
      console.error(
        `drift-check (--strict): could not read the DB — FAILING. ${(err as Error).message}`,
      );
      process.exit(3);
    }
    console.warn(
      `drift-check: could not read the DB — SKIPPING (this is NOT drift). ${(err as Error).message}`,
    );
    process.exit(0);
  }

  // Only compare tools the LLM is meant to see. CANONICAL_SURFACE
  // (src/lib/tools/categories.ts) is the authoritative list of advertised
  // names. Everything else is an "absorbed" handler that lives behind a
  // mega-tool router (e.g. take_screenshot behind `computer`) and has no
  // business being in tool_def.
  const local = localAll.filter((t) => CANONICAL_SURFACE.has(t.name));
  const localByName = new Map(local.map((t) => [t.name, t]));
  const dbByName = new Map(dbDefs.map((r) => [r.name, r]));
  const dbById = new Map(dbDefs.map((r) => [r.id, r]));

  // Binding lookup → tool ids that DO have an active chrome-extension binding.
  // (Already filtered to active in the fetch helper; double-check defensively.)
  const boundIds = new Set(dbBindings.filter((b) => b.is_active).map((b) => b.tool_id));

  // Surface inclusion → union of both chrome-extension surfaces'
  // `always_include_tools` arrays. A tool must appear in at least one to be
  // surfaced to the model.
  const surfaceIncluded = new Set<string>();
  const surfaceExcluded = new Map<string, Set<string>>();
  for (const s of dbSurfaces) {
    for (const n of s.always_include_tools ?? []) surfaceIncluded.add(n);
    if (s.never_include_tools?.length) {
      surfaceExcluded.set(s.surface_name, new Set(s.never_include_tools));
    }
  }

  const drifts: Drift[] = [];
  const localOnly: string[] = [];
  const dbOnly: string[] = [];
  const dbInactive: string[] = [];
  const missingBinding: string[] = [];
  const missingSurface: string[] = [];
  const excludedSurface: Array<{ name: string; surfaces: string[] }> = [];

  for (const [name, l] of localByName) {
    const d = dbByName.get(name);
    if (!d) {
      localOnly.push(name);
      continue;
    }
    if (d.is_active === false) dbInactive.push(name);
    const issues = compareTool(l, d);
    if (issues.length) drifts.push({ name, issues });

    // Binding check — every advertised tool MUST have an active
    // tool_binding row for executor_name='chrome-extension' (or a sub-
    // executor). Without it, the resolver doesn't know who runs it.
    if (!boundIds.has(d.id)) missingBinding.push(name);

    // Surface inclusion check — every advertised tool MUST be listed in
    // `tool_surface_defaults.always_include_tools` for at least one
    // chrome-extension/* surface, else the discovery handler never
    // shows it to the LLM.
    if (!surfaceIncluded.has(name)) missingSurface.push(name);

    // Defensive: if a surface explicitly EXCLUDES the tool, that's a
    // misconfig the resolver will respect — flag it loudly.
    const inExclude: string[] = [];
    for (const [surfaceName, excluded] of surfaceExcluded) {
      if (excluded.has(name)) inExclude.push(surfaceName);
    }
    if (inExclude.length) excludedSurface.push({ name, surfaces: inExclude });
  }

  for (const [name] of dbByName) {
    if (!localByName.has(name)) dbOnly.push(name);
  }

  // Orphan bindings — bindings pointing at DB ids that don't exist in the
  // chrome-extension owned set. With the FK constraint in 0070 this should
  // be unreachable, but keep the check as a deployment-state canary.
  const orphanBinding: string[] = [];
  for (const b of dbBindings) {
    if (!b.is_active) continue;
    if (!dbById.has(b.tool_id)) orphanBinding.push(`${b.executor_name}/${b.tool_id.slice(0, 8)}`);
  }

  const totalLocal = localByName.size;
  const totalDb = dbByName.size;
  const totalProblems =
    localOnly.length +
    dbOnly.length +
    drifts.length +
    missingBinding.length +
    missingSurface.length +
    excludedSurface.length +
    orphanBinding.length;

  // ── ANSI styling — bright red + bold + reverse for max screaming ─────────
  const isTTY = process.stdout.isTTY && process.env.NO_COLOR !== '1';
  const RED = isTTY ? '\x1b[1;91m' : '';
  const RED_BG = isTTY ? '\x1b[1;97;41m' : '';
  const YELLOW = isTTY ? '\x1b[1;93m' : '';
  const DIM = isTTY ? '\x1b[2m' : '';
  const RESET = isTTY ? '\x1b[0m' : '';

  console.log(
    `Tool-DB drift check v3 — local catalog ↔ tool.{definition, binding, surface_defaults}`,
  );
  console.log(
    `  local catalog tools (advertised): ${totalLocal}  ${DIM}(${localAll.length} total; absorbed handlers excluded via CANONICAL_SURFACE)${RESET}`,
  );
  console.log(`  DB tool.definition rows owned by chrome-extension: ${totalDb}`);
  console.log(
    `  DB tool.binding rows (active):              ${dbBindings.filter((b) => b.is_active).length}`,
  );
  console.log(`  DB tool.surface_defaults rows:              ${dbSurfaces.length}`);
  console.log('');

  if (totalProblems === 0) {
    console.log('\x1b[1;92m✓ No drift detected.\x1b[0m');
    process.exit(0);
  }

  // ── BIG RED BANNER ───────────────────────────────────────────────────────
  const bar = '████████████████████████████████████████████████████████████████████';
  console.log(`${RED_BG}${bar}${RESET}`);
  console.log(
    `${RED_BG}██${RESET}                                                                ${RED_BG}██${RESET}`,
  );
  console.log(
    `${RED_BG}██${RESET}   ${RED}⚠  TOOL-CATALOG / DB SCHEMA DRIFT DETECTED  ⚠${RESET}              ${RED_BG}██${RESET}`,
  );
  console.log(
    `${RED_BG}██${RESET}                                                                ${RED_BG}██${RESET}`,
  );
  console.log(
    `${RED_BG}██${RESET}   ${RED}${totalProblems} problem(s) found across ${drifts.length + localOnly.length} tool(s).${RESET}${' '.repeat(Math.max(0, 28 - String(totalProblems).length - String(drifts.length + localOnly.length).length))}${RED_BG}██${RESET}`,
  );
  console.log(
    `${RED_BG}██${RESET}   ${RED}The LLM sees one schema; the dispatcher accepts another.${RESET}      ${RED_BG}██${RESET}`,
  );
  console.log(
    `${RED_BG}██${RESET}                                                                ${RED_BG}██${RESET}`,
  );
  console.log(`${RED_BG}${bar}${RESET}`);
  console.log('');

  if (localOnly.length) {
    console.log(
      `${RED}✗ Local-only (${localOnly.length}) — exist in code but MISSING from tool.definition (or not bound to chrome-extension):${RESET}`,
    );
    for (const n of localOnly) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('');
  }

  if (dbOnly.length) {
    console.log(
      `${RED}✗ DB-only (${dbOnly.length}) — bound to chrome-extension but no local handler exposes them:${RESET}`,
    );
    for (const n of dbOnly) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('');
  }

  if (dbInactive.length) {
    console.log(
      `${YELLOW}⚠ DB-inactive (${dbInactive.length}) — in tool.definition but is_active=false:${RESET}`,
    );
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

  if (missingBinding.length) {
    console.log(
      `${RED}✗ Missing executor binding (${missingBinding.length}) — advertised but no active tool.binding row for executor_name='chrome-extension':${RESET}`,
    );
    for (const n of missingBinding) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('  Server cannot route these calls — they will fail with "no executor".');
    console.log('');
  }

  if (missingSurface.length) {
    console.log(
      `${RED}✗ Missing surface inclusion (${missingSurface.length}) — not in always_include_tools for either chrome-extension/{assistant,pilot}:${RESET}`,
    );
    for (const n of missingSurface) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('  Discovery handler will not surface these to the LLM on either chat path.');
    console.log('');
  }

  if (excludedSurface.length) {
    console.log(
      `${YELLOW}⚠ Explicitly excluded on a surface (${excludedSurface.length}) — listed in never_include_tools:${RESET}`,
    );
    for (const e of excludedSurface)
      console.log(`    ${DIM}-${RESET} ${e.name} (on ${e.surfaces.join(', ')})`);
    console.log('  The resolver will respect this; remove the entry if it was a mistake.');
    console.log('');
  }

  if (orphanBinding.length) {
    console.log(
      `${YELLOW}⚠ Orphan bindings (${orphanBinding.length}) — bindings pointing at deleted/renamed tools (should be impossible w/ FK; deployment-state canary):${RESET}`,
    );
    for (const n of orphanBinding) console.log(`    ${DIM}-${RESET} ${n}`);
    console.log('');
  }

  // ── REPEAT THE BANNER SO IT'S THE LAST THING ─────────────────────────────
  console.log(`${RED_BG}${bar}${RESET}`);
  console.log(
    `${RED_BG}██${RESET}   ${RED}DRIFT: ${totalProblems} problem(s). Fix tool.definition or local handlers.${RESET}${' '.repeat(Math.max(0, 22 - String(totalProblems).length))}${RED_BG}██${RESET}`,
  );
  console.log(`${RED_BG}${bar}${RESET}`);
  console.log('');
  console.log(`${DIM}Fix path — the DATABASE is the source of truth:${RESET}`);
  console.log(`${DIM}  - tool.definition is the truth (what the LLM sees).${RESET}`);
  console.log(
    `${DIM}  - Bring the handler's real Zod (src/lib/tools/handlers/*.ts) to match tool.definition.${RESET}`,
  );
  console.log(
    `${DIM}  - If the DB itself is wrong, change it (admin API / migration), then match code.${RESET}`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error('drift-check: unexpected error');
  console.error(err);
  process.exit(2);
});
