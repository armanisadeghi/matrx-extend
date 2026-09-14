/**
 * Read-only Supabase Management API helper for build-time checks whose source
 * tables are intentionally unavailable to the extension's publishable key.
 *
 * The Supabase CLI supplies the operator's authenticated Management API
 * credential. Its callers supply fixed query strings in sibling build scripts,
 * never user input. The SELECT prefix check catches accidental misuse; it is
 * not a general SQL-safety boundary. The helper runs queries from a disposable
 * work directory and returns validated rows.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadProjectRef(): string | null {
  let projectRef = process.env.MATRX_SUPABASE_PROJECT_REF ?? '';
  if (projectRef) return projectRef;

  for (const file of [
    '.env.production.local',
    '.env.production',
    '.env.development.local',
    '.env.development',
    '.env',
  ]) {
    const path = resolve(ROOT, file);
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

export function selectRowsViaManagementApi<T>(sql: string, isRow: (row: unknown) => row is T): T[] {
  if (!/^\s*select\b/i.test(sql)) {
    throw new Error('Management API helper only permits SELECT statements');
  }

  const projectRef = loadProjectRef();
  if (!projectRef) throw new Error('MATRX_SUPABASE_PROJECT_REF is absent');

  const workdir = mkdtempSync(join(tmpdir(), 'matrx-extend-management-read-'));
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
  if (!payload.rows.every(isRow)) {
    throw new Error('Supabase Management API returned an invalid row');
  }
  return payload.rows;
}
