#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
/**
 * Migration ledger check — the matrx-extend half of the cross-repo migration
 * durability system. See the "Database migrations" note in CLAUDE.md.
 *
 * Supabase (`brsgrqvjdzwihsvnfqkf`) is the source of truth for the database — NOT
 * the .sql files in `migrations/`. A migration file on disk has changed NOTHING
 * until it is applied. This script makes a forgotten one LOUD: it reads the shared
 * ledger `public._schema_migrations` (rows where source='matrx-extend' — the same
 * table aidream's db/apply_migrations.py writes, on the same DB) and diffs it
 * against the local `migrations/*.sql`. Anything the ledger has never seen, or whose
 * checksum drifted, is screamed in a big red box.
 *
 * READ-ONLY. This repo ships only the publishable key and cannot apply DDL or
 * write the ledger. The private ledger is read through the authenticated Supabase
 * CLI Management API when the browser-safe role cannot select it. Recording is
 * the applier's job. To apply + record a pending migration, from aidream run:
 *     python db/apply_migrations.py --source matrx-extend
 *
 *   pnpm check:migrations            # loud, non-blocking (exit 0)
 *   pnpm check:migrations --strict   # exit 1 when anything is unapplied (CI)
 *
 * A migration intentionally not meant to apply (superseded, destructive, already
 * live) is exempted with `-- migrate: skip: <reason>` in its first 25 lines.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { fetchPublicJson, loadSupabaseEnv } from './_supabase-rest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'matrx-extend';
const MIGRATIONS_DIR = resolve(ROOT, 'migrations');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};

const SKIP_MARKER = /^\s*--\s*migrate\s*:\s*skip(?:\s*:\s*(.+))?\s*$/i;

function skipReason(sql: string): string | null {
  for (const line of sql.split('\n', 25)) {
    const m = line.match(SKIP_MARKER);
    if (m) return (m[1] ?? '').trim();
  }
  return null;
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function listSql(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

interface LedgerRow {
  filename: string;
  checksum: string;
}

function loadProjectRef(): string | null {
  let projectRef = process.env.MATRX_SUPABASE_PROJECT_REF ?? '';
  if (projectRef) return projectRef;

  for (const f of [
    '.env.production.local',
    '.env.production',
    '.env.development.local',
    '.env.development',
    '.env',
  ]) {
    const path = resolve(ROOT, f);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = line.match(/^\s*MATRX_SUPABASE_PROJECT_REF\s*=\s*(.+?)\s*$/);
      if (!match) continue;
      projectRef = (match[1] ?? '').replace(/^['"]|['"]$/g, '');
      if (projectRef) return projectRef;
    }
  }
  return null;
}

function fetchLedgerViaManagementApi(projectRef: string): LedgerRow[] {
  const sql = `select filename, checksum from public._schema_migrations where source = '${SOURCE}' order by filename`;
  const workdir = mkdtempSync(join(tmpdir(), 'matrx-extend-migration-check-'));
  let output: string;
  try {
    output = execFileSync(
      'supabase',
      [
        'db',
        'query',
        '--linked',
        '--project-ref',
        projectRef,
        '--output',
        'json',
        '--workdir',
        workdir,
        sql,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
  const payload = JSON.parse(output) as { rows?: unknown };
  if (!Array.isArray(payload.rows)) {
    throw new Error('Supabase Management API returned no rows array');
  }
  return payload.rows.map((row) => {
    if (
      typeof row !== 'object' ||
      row === null ||
      typeof (row as Record<string, unknown>).filename !== 'string' ||
      typeof (row as Record<string, unknown>).checksum !== 'string'
    ) {
      throw new Error('Supabase Management API returned an invalid ledger row');
    }
    return row as LedgerRow;
  });
}

function loudBox(title: string): void {
  const bar = '═'.repeat(70);
  console.log(`${C.bold}${C.red}╔${bar}╗${C.reset}`);
  console.log(`${C.bold}${C.red}║  ${title.padEnd(66)}  ║${C.reset}`);
  console.log(`${C.bold}${C.red}╚${bar}╝${C.reset}`);
}

async function main(): Promise<number> {
  const strict = process.argv.includes('--strict');

  const files = listSql(MIGRATIONS_DIR);
  if (files.length === 0) {
    console.log(
      `${C.yellow}check:migrations — no .sql files in migrations/ — nothing to check${C.reset}`,
    );
    return 0;
  }

  const skipped: string[] = [];
  const local = new Map<string, string>();
  for (const f of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    if (skipReason(sql) !== null) {
      skipped.push(f);
      continue;
    }
    local.set(f, sha256(sql));
  }

  const env = loadSupabaseEnv();
  if (!env) {
    console.log(
      `${C.yellow}check:migrations — Supabase creds absent — ledger check skipped${C.reset}`,
    );
    return 0;
  }

  let ledgerRows: LedgerRow[];
  try {
    ledgerRows = await fetchPublicJson<LedgerRow[]>(
      env.url,
      env.key,
      `_schema_migrations?source=eq.${encodeURIComponent(SOURCE)}&select=filename,checksum`,
    );
  } catch (publicError) {
    const projectRef = loadProjectRef();
    try {
      if (!projectRef) throw new Error('MATRX_SUPABASE_PROJECT_REF is absent');
      ledgerRows = fetchLedgerViaManagementApi(projectRef);
      console.log(
        `${C.dim}check:migrations — private ledger verified through Supabase Management API${C.reset}`,
      );
    } catch (managementError) {
      // An unreachable ledger is not migration drift, but strict verification
      // must fail closed because a release cannot prove that its SQL is live.
      console.error(
        `${C.yellow}check:migrations — publishable read failed: ${String(publicError)}${C.reset}`,
      );
      console.error(
        `${C.yellow}check:migrations — Management API read failed: ${String(managementError)}${C.reset}`,
      );
      return strict ? 2 : 0;
    }
  }

  const ledger = new Map(ledgerRows.map((r) => [r.filename, r.checksum]));
  const pending: string[] = [];
  const drifted: string[] = [];
  for (const [f, sum] of local) {
    if (!ledger.has(f)) pending.push(f);
    else if (ledger.get(f) !== sum) drifted.push(f);
  }
  const orphans = ledgerRows
    .filter((r) => !local.has(r.filename) && !skipped.includes(r.filename))
    .map((r) => r.filename);

  const host = env.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  console.log(`${C.bold}━━━ migration ledger check (source='${SOURCE}') ━━━${C.reset}`);
  console.log(`  target: ${C.dim}${host}${C.reset}`);
  console.log(`  local:  ${files.length} file(s) in migrations/ (${skipped.length} skip-marked)`);
  console.log(`  ledger: ${ledgerRows.length} row(s) recorded for this source`);
  console.log(
    `  state:  ${C.green}${local.size - pending.length - drifted.length} applied${C.reset}, ` +
      `${pending.length ? C.red : C.dim}${pending.length} unapplied${C.reset}, ` +
      `${drifted.length ? C.yellow : C.dim}${drifted.length} drifted${C.reset}`,
  );

  if (pending.length || drifted.length) {
    console.log();
    loudBox('!!  UNAPPLIED MIGRATIONS - THE DB DOES NOT MATCH THIS REPO  !!');
    console.log(
      `${C.red}  A migration file on disk changed NOTHING until it is applied + recorded.${C.reset}`,
    );
    console.log(
      `${C.red}  Apply from the aidream repo:  python db/apply_migrations.py --source ${SOURCE}${C.reset}`,
    );
    if (pending.length) {
      console.log(`${C.bold}${C.red}  Never recorded (${pending.length}):${C.reset}`);
      for (const f of pending) console.log(`${C.red}    ✗ ${f}${C.reset}`);
    }
    if (drifted.length) {
      console.log(
        `${C.bold}${C.yellow}  Recorded but file changed since — re-apply or re-record (${drifted.length}):${C.reset}`,
      );
      for (const f of drifted) console.log(`${C.yellow}    ~ ${f}${C.reset}`);
    }
    if (orphans.length) {
      console.log(
        `${C.dim}  (${orphans.length} ledger row(s) with no matching file — harmless; deleted/renamed migrations)${C.reset}`,
      );
    }
    console.log(
      strict
        ? `${C.bold}${C.red}  --strict: failing.${C.reset}`
        : `${C.dim}  (non-blocking — exit 0 — but DO NOT ignore this)${C.reset}`,
    );
    return strict ? 1 : 0;
  }

  console.log(
    `${C.green}━━━ clean — every tracked migration is recorded in the ledger ━━━${C.reset}`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`${C.red}check:migrations — unexpected error:${C.reset}`, err);
    process.exit(2);
  },
);
