/**
 * EVERY ORG-SCOPED WRITE NAMES ITS ORGANIZATION — the class guard.
 *
 * Found 2026-09-26: `createTask` called `create_agent_task` with no
 * `p_organization_id`, so every schedule created from the extension was
 * refused (`organization_required`); the census of the same class found
 * `edu_import_deck` (capture_study_set) and the `users.user_form_profile`
 * upsert (NOT NULL organization_id) doing the same thing. A database default
 * or trigger may never pick the organization
 * (common-docs/projects/no-db-assigned-org/PLAN.md), so the client has to
 * send it — and nothing in the build notices when it doesn't.
 *
 * Two rules, both static over `src/`:
 *
 *  1. A call to an RPC that creates an org-scoped row with no parent to
 *     inherit from passes `p_organization_id`. The list below is those RPCs'
 *     LIVE signatures (read 2026-09-26 from pg_proc: each takes
 *     `p_organization_id`, and the first two raise `organization_required`
 *     when it is NULL). Add a new one here when the extension starts calling it.
 *  2. Every function that does a Supabase `.insert(` / `.upsert(` mentions the
 *     organization it is writing into (`organization_id` / `organizationId`),
 *     unless it is listed in NO_ORGANIZATION_COLUMN with the reason.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..');
const SRC = join(REPO, 'src');

const RPCS_THAT_NEED_AN_ORGANIZATION = new Set([
  'create_agent_task',
  'edu_import_deck',
  'create_user_table_with_fields',
]);

/** `file:function` → why the write carries no organization. */
const NO_ORGANIZATION_COLUMN: Record<string, string> = {};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !/\.(test|spec)\.tsx?$/.test(full)
    ) {
      out.push(full);
    }
  }
  return out;
}

function each(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => each(c, visit));
}

function enclosingFunction(node: ts.Node): ts.Node | null {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n)
    ) {
      // Prefer the OUTERMOST named function: an insert inside a `for` or a
      // `.map` callback belongs to the function that resolved the org.
      let outer: ts.Node = n;
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) outer = p;
      }
      return outer;
    }
  }
  return null;
}

function functionName(fn: ts.Node): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    return fn.name.getText();
  }
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p)) return p.name.getText();
  return '<anonymous>';
}

interface Site {
  file: string;
  line: number;
  what: string;
  fn: string;
  ok: boolean;
}

function scan(): { rpc: Site[]; writes: Site[] } {
  const rpc: Site[] = [];
  const writes: Site[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    if (!/\.(rpc|insert|upsert)\(/.test(text)) continue;
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    each(sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      const method = n.expression.name.text;
      const rel = relative(REPO, file);
      const lineNo = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      const fnNode = enclosingFunction(n);
      const fn = fnNode ? functionName(fnNode) : '<module>';
      if (method === 'rpc') {
        const [name, args] = n.arguments;
        if (!name || !ts.isStringLiteralLike(name)) return;
        if (!RPCS_THAT_NEED_AN_ORGANIZATION.has(name.text)) return;
        const ok =
          !!args &&
          ts.isObjectLiteralExpression(args) &&
          args.properties.some((p) => p.name?.getText(sf) === 'p_organization_id');
        rpc.push({ file: rel, line: lineNo, what: name.text, fn, ok });
        return;
      }
      if (method !== 'insert' && method !== 'upsert') return;
      // Only Supabase query builders: `…from('x').insert(…)`.
      if (!/\.from\(/.test(n.expression.expression.getText(sf))) return;
      const body = fnNode ? fnNode.getText(sf) : '';
      const ok =
        /organization_id|organizationId/.test(body) || `${rel}:${fn}` in NO_ORGANIZATION_COLUMN;
      writes.push({ file: rel, line: lineNo, what: method, fn, ok });
    });
  }
  return { rpc, writes };
}

describe('org-scoped writes name their organization', () => {
  const { rpc, writes } = scan();

  it('finds the write sites it is meant to guard', () => {
    // If these collapse, the scan stopped guarding anything.
    expect(rpc.length).toBeGreaterThanOrEqual(3);
    expect(writes.length).toBeGreaterThanOrEqual(8);
  });

  it('every call to an organization-requiring RPC passes p_organization_id', () => {
    const bad = rpc
      .filter((s) => !s.ok)
      .map(
        (s) =>
          `${s.file}:${s.line}: \`${s.fn}\` calls ${s.what} without p_organization_id — ` +
          'resolve it with requireActiveOrganizationId() (holds on the picker) and pass it.',
      );
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('every function that inserts or upserts a row names its organization', () => {
    const bad = writes
      .filter((s) => !s.ok)
      .map(
        (s) =>
          `${s.file}:${s.line}: \`${s.fn}\` does .${s.what}() with no organization_id — ` +
          'send the organization explicitly (requireActiveOrganizationId), or list it in ' +
          'NO_ORGANIZATION_COLUMN with the reason the table has none.',
      );
    expect(bad, bad.join('\n')).toEqual([]);
  });
});
