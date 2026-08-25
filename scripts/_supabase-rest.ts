/**
 * Shared Supabase REST reader for build-time tool scripts (the drift check and
 * the docs generator). Reads the `public` schema with the publishable/anon key
 * — the same credentials the extension ships.
 *
 * The DATABASE is the source of truth (common-docs/systems/agents/agent-tools/STATE.md). These
 * scripts only READ it; there is no code→DB sync (Rule 7).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Resolve Supabase URL + publishable key from the environment, falling back to
 * the repo's `.env*` files. Returns null when neither is available — callers
 * decide whether that is a loud skip (it never throws here). No on/off flag
 * gates this (Rule 6); missing credentials simply mean "cannot read the DB".
 *
 * ONE name per value — `WXT_SUPABASE_URL` / `WXT_SUPABASE_PUBLISHABLE_KEY`.
 * Never add a second candidate or a fallback chain; pointing this at another
 * database is a change of VALUES. See
 * /Users/armanisadeghi/code/common-docs/policies/package-vs-implementation.md
 */
export function loadSupabaseEnv(): { url: string; key: string } | null {
  let url = process.env.WXT_SUPABASE_URL ?? '';
  let key = process.env.WXT_SUPABASE_PUBLISHABLE_KEY ?? '';

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
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
        if (!m) continue;
        const [, k, raw] = m;
        const v = (raw ?? '').replace(/^['"]|['"]$/g, '');
        if (!url && k === 'WXT_SUPABASE_URL') url = v;
        if (!key && k === 'WXT_SUPABASE_PUBLISHABLE_KEY') key = v;
      }
      if (url && key) break;
    }
  }

  return url && key ? { url, key } : null;
}

/**
 * Fetch JSON from a Supabase schema via PostgREST. Throws on a non-2xx
 * response so callers can treat "couldn't read" as a non-blocking warning
 * (it is NOT drift).
 *
 * @param schema - The Postgres schema to target via `Accept-Profile` header.
 *   Defaults to `'public'`. After the 2026-06 schema canonicalization the
 *   tool tables moved to the `tool` schema (`tool.definition`, `tool.binding`,
 *   `tool.surface_defaults`), so pass `'tool'` for those queries.
 */
export async function fetchPublicJson<T>(
  url: string,
  key: string,
  path: string,
  schema = 'public',
): Promise<T> {
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/${path}`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      // The custom Supabase proxy at db.matrxserver.com defaults to schema
      // 'api'; always request the schema explicitly.
      'Accept-Profile': schema,
    },
  });
  if (!res.ok) {
    throw new Error(
      `Supabase fetch failed (${res.status}) on ${schema}.${path}: ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}
