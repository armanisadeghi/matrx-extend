/**
 * Class guard: every backend path the extension calls through the shared
 * request helpers must exist on aidream with that method.
 *
 * read_pdf POSTed to `/pdf/extract-text` for months: the router is mounted at
 * `/utilities`, so every call 404'd and nothing caught it. This scans every
 * literal path handed to apiGet/apiPost/apiPatch/apiPut/apiDelete and checks it
 * against the committed OpenAPI snapshot (`pnpm update-api-types` refreshes it).
 * A leading `/api` is stripped first — aidream's ApiPrefixCompatMiddleware and
 * the reverse proxy remove it before route matching.
 *
 * Scope: a path written as a string or template literal starting with `/`.
 * Paths built from a variable (`${BASE}/x`, a helper fn) are not seen here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const openapi = JSON.parse(
  readFileSync(path.join(ROOT, 'types/python-generated/openapi.json'), 'utf8'),
) as { paths: Record<string, Record<string, unknown>> };

const CALL = /\bapi(Get|Post|Patch|Put|Delete)\b(?:<[^()]*?>)?\(\s*(['"`])(\/[^'"`]*)\2/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function findBackendCalls(source: string): Array<{ method: string; path: string }> {
  const calls: Array<{ method: string; path: string }> = [];
  for (const m of source.matchAll(CALL)) {
    calls.push({ method: (m[1] as string).toLowerCase(), path: m[3] as string });
  }
  return calls;
}

function toTemplate(raw: string): RegExp {
  const bare = raw.split('?')[0] as string;
  const stripped = bare.startsWith('/api/') ? bare.slice(4) : bare;
  const pattern = stripped
    .split(/\$\{[^}]*\}/)
    .map((s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
  return new RegExp(`^${pattern}$`);
}

function resolves(method: string, raw: string): boolean {
  const re = toTemplate(raw);
  return Object.entries(openapi.paths).some(
    ([p, ops]) => method in ops && re.test(p.replace(/\{[^}]+\}/g, 'x')),
  );
}

describe('extension backend paths exist on aidream', () => {
  it('the scanner sees a known call and catches the old read_pdf path', () => {
    expect(findBackendCalls("apiPost<X>('/pdf/extract-text', body)")).toEqual([
      { method: 'post', path: '/pdf/extract-text' },
    ]);
    expect(resolves('post', '/pdf/extract-text')).toBe(false);
    expect(resolves('get', '/health')).toBe(true);
    expect(resolves('get', '/api/compute-targets/')).toBe(true);
  });

  it('every literal backend path resolves to a route with that method', () => {
    const missing: string[] = [];
    for (const file of walk(path.join(ROOT, 'src'))) {
      for (const call of findBackendCalls(readFileSync(file, 'utf8'))) {
        if (!resolves(call.method, call.path)) {
          missing.push(`${path.relative(ROOT, file)}: ${call.method.toUpperCase()} ${call.path}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
