/**
 * check-schema-routing — guard against the bug class that `tsc` cannot see.
 *
 * The platform DB split `public` into ~48 domain schemas. PostgREST resolves
 * `.from('x')` against `public` unless the call is schema-qualified, so an
 * unqualified `.from()` on a moved table does not fail at build time — it fails
 * in a user's browser with:
 *
 *     PGRST205  Could not find the table 'public.wbx_pattern' in the schema cache
 *
 * That is exactly how 35 call sites silently rotted: a previous migration pass
 * updated the COLUMNS but never added the schema qualification, and nothing in
 * `tsc`, `biome`, the tests, or `wxt build` said a word.
 *
 * This script fails loudly if any `.from('<moved table>')` is not routed through
 * a schema — either a `.schema(...)` call or one of the accessors in
 * `src/lib/supabase/schemas.ts` (extendDb(), schedulerDb(), ...).
 *
 *   pnpm check:schema-routing            # report + exit 0
 *   pnpm check:schema-routing --strict   # exit 1 on any finding (CI / release)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const STRICT = process.argv.includes('--strict');

/**
 * Tables that do NOT live in `public` anymore. Mirrors TABLE_SCHEMA in
 * src/lib/supabase/schemas.ts — if you add a table there, add it here.
 */
const MOVED_TABLES: Record<string, string> = {
  wbx_pattern: 'extend',
  wbx_recipe: 'extend',
  wbx_capture: 'extend',
  wbx_guidance: 'extend',
  wbx_screenshot: 'extend',
  wbx_seo_audit: 'extend',
  wbx_highlight: 'extend',
  sch_task: 'scheduler',
  sch_run: 'scheduler',
  sch_trigger: 'scheduler',
  sch_agent_task: 'scheduler',
  notes: 'workbench',
  note_folders: 'workbench',
  udt_datasets: 'workbench',
  udt_dataset_fields: 'workbench',
  conversation: 'chat',
  message: 'chat',
  tool_call: 'chat',
  user_form_profile: 'users',
  admins: 'admin',
  definition: 'tool',
  model_definition: 'ai',
};

/** Tables that were REMOVED outright — using them at all is a bug. */
const REMOVED_TABLES: Record<string, string> = {
  model: 'ai.model was split — use ai.model_definition (via aiDb())',
  tool_def: 'renamed — use tool.definition (via toolDb())',
  tool_binding: 'renamed — see the tool schema',
  cx_tool_call: 'renamed — use chat.tool_call (via chatDb())',
  cx_conversation: 'renamed — use chat.conversation (via chatDb())',
};

const ACCESSOR = /(?:extendDb|schedulerDb|workbenchDb|chatDb|usersDb|adminDb|toolDb|aiDb)\(\)/;

/**
 * A `.from()` is qualified if the thing it is called ON is schema-scoped. That
 * receiver is usually a local: `const sch = schedulerDb()` … 60 lines later …
 * `sch.from('sch_task')`. A line-window heuristic gets this wrong in both
 * directions, so instead we collect every local bound to a schema-scoped client
 * and check the receiver by name.
 */
const QUALIFIED_BINDING = new RegExp(
  String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*(?:${ACCESSOR.source}|\.schema\()`,
);

interface Finding {
  file: string;
  line: number;
  table: string;
  detail: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const findings: Finding[] = [];

for (const file of walk(SRC)) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');

  // Every local in this file that holds a schema-scoped client.
  const qualifiedVars = new Set<string>();
  for (const line of lines) {
    const b = QUALIFIED_BINDING.exec(line);
    if (b?.[1] !== undefined) qualifiedVars.add(b[1]);
  }

  lines.forEach((line, i) => {
    const m = /\.from\(['"]([a-zA-Z0-9_]+)['"]\)/.exec(line);
    if (!m) return;
    const table = m[1];
    if (table === undefined) return;

    const removed = REMOVED_TABLES[table];
    if (removed !== undefined) {
      findings.push({ file, line: i + 1, table, detail: `TABLE NO LONGER EXISTS: ${removed}` });
      return;
    }

    const wantSchema = MOVED_TABLES[table];
    if (wantSchema === undefined) return;

    // Collapse the builder chain onto one line — supabase-js calls are routinely
    // split across lines (`await sch` \n `.from('sch_task')`), so the receiver
    // and the `.schema()` hop often are not on the same physical line as `.from`.
    const chain = lines
      .slice(Math.max(0, i - 3), i + 1)
      .join(' ')
      .replace(/\s+/g, ' ');

    // Qualified inline: `.schema('x').from(...)` or `extendDb().from(...)`.
    if (/\.schema\(/.test(chain) || ACCESSOR.test(chain)) return;

    // Qualified by receiver: `const sch = schedulerDb()` … `await sch.from(...)`.
    const recv = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\.\s*from\(/.exec(chain);
    if (recv?.[1] !== undefined && qualifiedVars.has(recv[1])) return;

    findings.push({
      file,
      line: i + 1,
      table,
      detail: `unqualified — resolves to public.${table}, which does not exist. Route via ${wantSchema} (see src/lib/supabase/schemas.ts).`,
    });
  });
}

if (findings.length === 0) {
  console.log('✓ schema routing: every .from() on a moved table is schema-qualified.');
  process.exit(0);
}

console.error('');
console.error('╔════════════════════════════════════════════════════════════════════════╗');
console.error('║  UNQUALIFIED SUPABASE TABLE ROUTING — THESE FAIL AT RUNTIME (PGRST205) ║');
console.error('╚════════════════════════════════════════════════════════════════════════╝');
console.error('');
for (const f of findings) {
  console.error(`  ${relative(ROOT, f.file)}:${f.line}  .from('${f.table}')`);
  console.error(`      ${f.detail}`);
}
console.error('');
console.error(`  ${findings.length} call site(s). tsc and the build CANNOT catch these.`);
console.error('');
process.exit(STRICT ? 1 : 0);
