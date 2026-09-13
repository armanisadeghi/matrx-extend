#!/usr/bin/env tsx
/**
 * check:archived-items-law — every list over an archivable entity carries an
 * archive control, and the default hides archived rows.
 *
 * THE LAW (Arman, 2026-09-09, verbatim — full text at
 * `../../common-docs/policies/archived-items.md`):
 *
 *   "everything should have an archive filter, and the default should always
 *    hide archived, but seeing archived items should be one or two clicks
 *    away … this is a system wide decision for every single item everywhere in
 *    our system, for every single table and every single page."
 *
 * Ported from matrx-frontend `scripts/check-archived-items-law.ts` — SAME
 * CONTRACT, two deliberate differences this repo forces:
 *
 *  1. matrx-frontend DERIVES the archivable-table set from its generated
 *     `types/database.types.ts`. This repo has no generated DB types, so the
 *     archive COLUMN NAME is the signal instead: any read chain that names
 *     `is_archived` / `archived_at` is, by construction, a read over an
 *     archivable entity. Strictly more conservative in the direction that
 *     matters — a query that never mentions the column cannot be hiding rows
 *     with it.
 *  2. It also watches the HTTP boundary (`archived=false`, `archived: false`
 *     in a request body/params), because a Chrome extension hides rows by
 *     asking the server to, not only by predicating a PostgREST chain.
 *
 * WHAT THIS GUARD FAILS ON
 *
 *   1. HARDCODED PREDICATE — a multi-row read whose archive predicate is a
 *      literal (`.eq('is_archived', false)`, `.is('archived_at', null)`,
 *      `archived: false`) with nothing in the file that could ever flip it.
 *      That is "hidden with zero clicks to reveal" — what the law outlaws.
 *   2. COLUMN WITHOUT A CONTROL — a `.tsx` that names an archive field, maps
 *      rows to JSX, and offers no archive control at all: archived and active
 *      render mixed and unlabelled.
 *
 * WHAT IT DELIBERATELY DOES NOT FAIL ON
 *
 *   • Single-record reads (`.single()`, `.maybeSingle()`, `.eq('id', …)`,
 *     `head: true`). One record is not a list.
 *   • `deleted_at` (soft delete). Deletion is not archiving — db-rules §6d.
 *   • Writes (`.update`, `.insert`, `.upsert`, `.delete`) — archiving a row IS
 *     a write of `is_archived`.
 *   • A file carrying a real control (`showArchived`, `includeArchived`,
 *     `archFilter`, `archiveFilter`, `AgentArchFilter`, `ArchiveFilter`, …).
 *
 * WHAT IT CANNOT SEE — say so; never let green imply more than it proves.
 *
 *   A signature that ALREADY exposes an archive option no caller ever passes
 *   reads GREEN here: the option exists, so the query is not hardcoded. That
 *   is exactly the shape matrx-local's Claude History Inventory shipped for
 *   months (`archived?: boolean` on the client, on the route and in the SQL —
 *   and nothing setting it). Whether a control reaches a VISIBLE affordance is
 *   proven in a component test and in the browser, never by this file.
 *
 *   And TODAY this repo's every archivable list is the agent picker, whose
 *   control lives in `@ai-matrx/agents/catalog` (census row C1). So a live
 *   scan here finds nothing — the guard is what makes the NEXT list obey
 *   without anyone remembering the law. Its self-test is where it proves it
 *   can fail.
 *
 * ESCAPE HATCH: an internal reader that genuinely must not offer a control (a
 * machine path, a health probe) declares it at the query:
 *
 *     // archived-items-law-exempt: pairing probe, never rendered as a list
 *
 * with 12+ characters of reason. A bare marker does not count.
 *
 * Run: pnpm check:archived-items-law
 * Prove the detector: pnpm check:archived-items-law:self-test
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EXEMPTION = /archived-items-law-exempt:\s*(.{12,})/;

/** The archive columns. `deleted_at` is deliberately NOT one of them. */
const ARCHIVE_COLUMNS = ['is_archived', 'archived_at'] as const;

/**
 * Anything that could ever flip the archive predicate. Presence in the file is
 * the "a control exists" test; a browser/component check is what proves it is
 * wired to something a person can see.
 */
const CONTROL_SIGNALS: readonly RegExp[] = [
  /\binclude_?[Aa]rchived\b/,
  /\bshow_?[Aa]rchived\b/,
  /\bwith_?[Aa]rchived\b/,
  /\barchive[dD]?Filter\b/,
  /\bArchiveFilter\b/,
  /\bArchivedFilter\b/,
  /\bArchivedDisclosure\b/,
  /\barchFilter\b/,
  /\bp_archived\b/,
  /\bp_include_archived\b/,
  /\barchivedOnly\b/,
];

/** A chain carrying one of these is a single-record read, not a list. */
const SINGLE_RECORD_SIGNALS: readonly RegExp[] = [
  /\.maybeSingle\s*(?:<[^;]*?>)?\s*\(/,
  /\.single\s*(?:<[^;]*?>)?\s*\(/,
  /\.eq\s*\(\s*['"`]id['"`]\s*,/,
  /head\s*:\s*true/,
];

/** A chain carrying one of these is a write, not a read. */
const WRITE_SIGNALS: readonly RegExp[] = [
  /\.update\s*\(/,
  /\.insert\s*\(/,
  /\.upsert\s*\(/,
  /\.delete\s*\(/,
];

/**
 * The literal predicate, in every shape this client can write one:
 * a PostgREST filter, an RPC/body field, or a query-string parameter.
 */
const HARDCODED_PREDICATES: readonly RegExp[] = [
  /\.(?:eq|is|neq)\s*\(\s*['"`](?:is_archived|archived_at)['"`]\s*,\s*(?:false|true|null)\s*\)/,
  /\b(?:is_archived|archived|p_archived)\s*:\s*(?:false|true)\b/,
  /\barchived=(?:false|true)\b/,
];

// ── Comment stripping (same shape as check-canonical-pickers) ──────────────
// Offsets — and therefore reported line numbers — are preserved. Nothing in a
// comment may trip the guard OR whitelist a file; the ONE exception is the
// exemption marker, read from the RAW text on purpose.
function stripComments(text: string): string {
  const blank = (chunk: string) => chunk.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (match, lead: string) => lead + ' '.repeat(match.length - lead.length),
    );
}

export interface Finding {
  file: string;
  line: number;
  reason: string;
}

function lineFor(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}

function anyMatch(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * The ONE statement a match belongs to: from the start of its line to the `;`
 * that ends the chain (capped, for an unterminated tail). 🚨 The window MUST
 * stop at the statement boundary — a fixed character budget lets a neighbour's
 * predicate hide a real finding (the bug matrx-frontend's copy fixed).
 */
const CHAIN_BUDGET = 2400;

function chainWindow(code: string, at: number): string {
  const lineStart = code.lastIndexOf('\n', at) + 1;
  const hardEnd = Math.min(code.length, at + CHAIN_BUDGET);
  const semicolon = code.indexOf(';', at);
  const end = semicolon >= 0 ? Math.min(semicolon + 1, hardEnd) : hardEnd;
  return code.slice(lineStart, end);
}

export function scanFile(file: string, raw: string): Finding[] {
  const code = stripComments(raw);
  const findings: Finding[] = [];

  // 🚨 The control test runs over the code with every LITERAL archive
  // predicate blanked out. `p_archived: false` and `archFilter` are the same
  // words — one is the control, the other is the violation — so counting the
  // violation as its own control is how this guard would whitelist exactly
  // what it exists to catch.
  let controlProbe = code;
  for (const pattern of HARDCODED_PREDICATES) {
    controlProbe = controlProbe.replace(new RegExp(pattern.source, 'g'), (chunk) =>
      chunk.replace(/[^\n]/g, ' '),
    );
  }
  if (anyMatch(controlProbe, CONTROL_SIGNALS)) return findings;

  // ── RULE 1 — the hardcoded predicate, wherever it is written.
  const seenLines = new Set<number>();
  for (const pattern of HARDCODED_PREDICATES) {
    const global = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = global.exec(code)) !== null) {
      const window = chainWindow(code, match.index);
      if (anyMatch(window, WRITE_SIGNALS)) continue;
      if (anyMatch(window, SINGLE_RECORD_SIGNALS)) continue;

      // The exemption is read from the RAW text — an exemption IS a comment.
      const rawWindow = raw.slice(Math.max(0, match.index - 600), match.index + 400);
      if (EXEMPTION.test(rawWindow)) continue;

      const line = lineFor(code, match.index);
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      findings.push({
        file,
        line,
        reason:
          `list read hardcodes \`${match[0].trim()}\` with no archive control anywhere in ` +
          'the file — archived rows are impossible to reveal',
      });
    }
  }

  // ── RULE 2 — THE SCREEN THAT LIES. A component that names the archive
  // field (so it knows perfectly well which rows are archived), maps rows to
  // JSX, and offers no control: archived and active land in one list,
  // indistinguishable. Scoped to .tsx that actually renders — a service that
  // hands the field to a caller owning the control is doing the RIGHT thing,
  // and a guard that fires on every layered service is one agents delete.
  if (findings.length === 0 && file.endsWith('.tsx') && /\.map\s*\(/.test(code)) {
    for (const column of ARCHIVE_COLUMNS) {
      const global = new RegExp(`\\b${column}\\b`, 'g');
      const match = global.exec(code);
      if (!match) continue;
      const rawWindow = raw.slice(Math.max(0, match.index - 600), match.index + 400);
      if (EXEMPTION.test(rawWindow)) continue;
      findings.push({
        file,
        line: lineFor(code, match.index),
        reason:
          `component names \`${column}\`, renders the rows, and offers no archive ` +
          'control — archived and active render mixed and unlabelled',
      });
      break;
    }
  }

  return findings;
}

function sourceFiles(): string[] {
  const out = execSync("git ls-files --cached --others --exclude-standard '*.ts' '*.tsx'", {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((file) => file.startsWith('src/'))
    .filter((file) => existsSync(path.join(ROOT, file)))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file));
}

// ── Self-test — a guard you cannot demonstrate failing is not a guard ──────

/** RED — the census's category (b): hidden, zero clicks to reveal. */
const RED_HARDCODED = `
const { data } = await extendDb()
  .from('saved_jobs')
  .select('id, title, is_archived')
  .eq('is_archived', false)
  .order('created_at', { ascending: false });
`;

/** RED — the HTTP shape: a client asking the server to hide, always. */
const RED_HTTP_PARAM = `
const res = await fetch(\`\${base}/coding-sessions/inventory?limit=50&archived=false\`);
`;

/** RED — the request-body shape. */
const RED_BODY_FIELD = `
const rows = await client.rpc('agx_list_scoped', { p_scope: 'mine', p_archived: false });
`;

/** RED — a component that knows which rows are archived and says nothing. */
const RED_COLUMN_NO_CONTROL = `
export function JobsPanel({ jobs }: { jobs: Job[] }) {
  return <ul>{jobs.map((job) => <li key={job.id}>{job.title}{job.is_archived}</li>)}</ul>;
}
`;

/** RED — a comment mentioning a control must not whitelist a hard predicate. */
const RED_COMMENT_ONLY_CONTROL = `
// TODO: add a showArchived toggle here one day
const { data } = await extendDb().from('saved_jobs').select('*').eq('is_archived', false);
`;

/** GREEN — the predicate is driven by an option the UI can flip. */
const GREEN_CONTROLLED = `
let query = extendDb().from('saved_jobs').select('*');
if (!opts.includeArchived) query = query.eq('is_archived', false);
`;

/** GREEN — the package's own tri-state, the platform answer for agent lists. */
const GREEN_PACKAGE_FILTER = `
import type { AgentArchFilter } from '@ai-matrx/agents/catalog';
const rows = await client.rpc('agx_list_scoped', { p_archived: archFilter });
`;

/** GREEN — a single record is not a list. */
const GREEN_SINGLE = `
const { data } = await extendDb()
  .from('saved_jobs')
  .select('id')
  .eq('is_archived', false)
  .maybeSingle<{ id: string }>();
`;

/** GREEN — archiving a row IS a write of the column. */
const GREEN_WRITE = `
await extendDb().from('saved_jobs').update({ is_archived: true }).eq('id', id);
`;

/** GREEN — a declared, reasoned exemption. */
const GREEN_EXEMPT = `
// archived-items-law-exempt: pairing probe, never rendered as a list
const { data } = await extendDb().from('saved_jobs').select('*').eq('is_archived', false);
`;

/** GREEN — soft delete is not archiving. */
const GREEN_DELETED_AT = `
const { data } = await extendDb().from('saved_jobs').select('*').is('deleted_at', null);
`;

/** GREEN — a service handing the field to a caller that owns the control. */
const GREEN_SERVICE_LAYER = `
export async function listJobs(orgId: string) {
  const { data } = await extendDb().from('saved_jobs').select('id, title, is_archived');
  return data;
}
`;

function selfTest(): void {
  const failures: string[] = [];
  const expectRed = (name: string, source: string, file = 'self-test.ts') => {
    if (scanFile(file, source).length === 0) {
      failures.push(
        `${name}: the detector stayed GREEN on a source that breaks the law — ` +
          'a guard that cannot fail proves nothing.',
      );
    }
  };
  const expectGreen = (name: string, source: string, file = 'self-test.ts') => {
    const found = scanFile(file, source);
    if (found.length > 0) {
      failures.push(
        `${name}: false positive — ${found[0]?.reason}. False positives get guards deleted.`,
      );
    }
  };

  expectRed('HARDCODED-PREDICATE', RED_HARDCODED);
  expectRed('HTTP-PARAM', RED_HTTP_PARAM);
  expectRed('BODY-FIELD', RED_BODY_FIELD);
  expectRed('COLUMN-NO-CONTROL', RED_COLUMN_NO_CONTROL, 'self-test.tsx');
  expectRed('COMMENT-ONLY-CONTROL', RED_COMMENT_ONLY_CONTROL);
  expectGreen('CONTROLLED', GREEN_CONTROLLED);
  expectGreen('PACKAGE-FILTER', GREEN_PACKAGE_FILTER);
  expectGreen('SINGLE-RECORD', GREEN_SINGLE);
  expectGreen('WRITE', GREEN_WRITE);
  expectGreen('EXEMPT', GREEN_EXEMPT);
  expectGreen('DELETED-AT', GREEN_DELETED_AT);
  expectGreen('SERVICE-LAYER', GREEN_SERVICE_LAYER);

  if (failures.length > 0) {
    console.error('\n🚨 check:archived-items-law SELF-TEST FAILED\n');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error('\nFix scripts/check-archived-items-law.ts before trusting a green run.\n');
    process.exit(1);
  }

  console.log(
    "✅ self-test: RED on a hardcoded `.eq('is_archived', false)` list read, on an\n" +
      '   `archived=false` query string, on a `p_archived: false` body field, on a list\n' +
      '   component that names the column with no control, and when the only "control" is\n' +
      '   a comment; GREEN on an option-driven predicate, the package tri-state, a\n' +
      '   single-record read, a write, a reasoned exemption, `deleted_at`, and a service\n' +
      '   layer handing the field to its caller.',
  );
}

function main(): void {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const findings: Finding[] = [];
  for (const file of sourceFiles()) {
    findings.push(...scanFile(file, readFileSync(path.join(ROOT, file), 'utf8')));
  }

  if (findings.length === 0) {
    console.log(
      '✅ THE ARCHIVED-ITEMS LAW holds in src/: no list read hides archived rows with no\n' +
        "   way to reveal them. (This repo's only archivable list is the agent picker, whose\n" +
        '   tri-state control lives in @ai-matrx/agents/catalog — proven by\n' +
        '   tests/unit/agent-archive-filter.test.tsx, not by this scan.)',
    );
    return;
  }

  console.error('\n🚨 ARCHIVED-ITEMS LAW VIOLATIONS\n');
  for (const finding of findings) {
    console.error(`  ✗ ${finding.file}:${finding.line} — ${finding.reason}`);
  }
  console.error(
    '\nEvery list over an archivable entity carries an archive control, the default hides\n' +
      'archived rows, and revealing them is one or two clicks — Arman, 2026-09-09\n' +
      '(../common-docs/policies/archived-items.md).\n\n' +
      'In this repo:\n' +
      '  • agent lists → @ai-matrx/agents/catalog `archFilter` (the chip is already on the\n' +
      '    filter bar; a host that hides the bar must render its own bound control)\n' +
      '  • anything else → @ai-matrx/design-system `<ArchiveFilter>`, its value passed to\n' +
      '    the READER (an RPC `p_archived`, an endpoint `archived=`) so counts do not lie\n\n' +
      'An internal reader that is genuinely not a user-facing list declares it at the\n' +
      'query: `// archived-items-law-exempt: <reason>` (12+ characters of reason).\n',
  );
  process.exit(1);
}

main();
