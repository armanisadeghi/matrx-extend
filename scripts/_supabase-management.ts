/**
 * Read-only build-time queries for catalog and migration checks. The operator
 * token stays in aidream's private runtime environment (or process config),
 * never in the extension's public WXT_* environment or generated artifacts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACCESS_TOKEN_FILE = resolve(ROOT, '../aidream/.env');
const MANAGEMENT_API = 'https://api.supabase.com/v1/projects';

function readEnvFileValue(path: string, name: string): string | null {
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match?.[1] !== name) continue;
    const value = (match[2] ?? '').replace(/^['"]|['"]$/g, '');
    if (value) return value;
  }
  return null;
}

function loadProjectRef(): string {
  const projectRef = process.env.MATRX_SUPABASE_PROJECT_REF ??
    ['.env.production.local', '.env.production', '.env.development.local', '.env.development', '.env']
      .map((name) => readEnvFileValue(resolve(ROOT, name), 'MATRX_SUPABASE_PROJECT_REF'))
      .find((value) => value !== null);
  if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
    throw new Error('MATRX_SUPABASE_PROJECT_REF is missing or invalid');
  }
  return projectRef;
}

function loadOperatorToken(): string {
  const token = process.env.SUPABASE_ACCESS_TOKEN ??
    readEnvFileValue(ACCESS_TOKEN_FILE, 'SUPABASE_ACCESS_TOKEN');
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is missing from operator configuration');
  return token;
}

function readTimeoutMs(): number {
  const value = Number(process.env.MATRX_MANAGEMENT_READ_TIMEOUT_MS ?? '30000');
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('MATRX_MANAGEMENT_READ_TIMEOUT_MS must be a positive integer');
  }
  return value;
}

export async function selectRowsViaManagementApi<T>(sql: string, isRow: (row: unknown) => row is T): Promise<T[]> {
  const statement = sql.trim().replace(/;$/, '');
  if (!/^select\b/i.test(statement) || statement.includes(';')) {
    throw new Error('Management API helper only permits a single SELECT statement');
  }

  const projectRef = loadProjectRef();
  const token = loadOperatorToken();
  let response: Response;
  try {
    response = await fetch(`${MANAGEMENT_API}/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: statement, read_only: true }),
      signal: AbortSignal.timeout(readTimeoutMs()),
    });
  } catch {
    throw new Error('Supabase Management API read did not complete');
  }
  if (response.status !== 201) {
    throw new Error(`Supabase Management API read failed (HTTP ${response.status})`);
  }

  let rows: unknown;
  try {
    rows = await response.json();
  } catch {
    throw new Error('Supabase Management API returned invalid JSON');
  }
  if (!Array.isArray(rows) || !rows.every(isRow)) {
    throw new Error('Supabase Management API returned invalid rows');
  }
  return rows;
}
