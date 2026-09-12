/**
 * THE GUARD FOR THE CLASS: a control that destroys data must stop and confirm.
 *
 * Arman's destructive-and-expensive-actions law (2026-08-29) was swept across
 * this repo on 2026-09-08 — and the sweep fixed ONE surface (AgendaView,
 * 9b451c4) and stopped. `confirm-consequence.test.ts` came out of that sweep
 * and guards the COPY of confirmations that exist; it cannot see a delete
 * button that never opens a confirmation at all, which is what the other ten
 * surfaces had. This is that missing half.
 *
 * It is a real AST walk (the `typescript` compiler API), not a grep, because
 * the shapes it has to tell apart — `onClick={() => deleteThing(id)}` versus
 * `confirmDestructive({ …, run: () => deleteThing(id) })` — differ only in
 * which callback the call sits inside.
 *
 * TWO CHECKS, and the registry `src/lib/destructive/operations.ts` joins them:
 *
 *  1. DISCOVERY: every function in `src/` that performs a permanent removal is
 *     registered. This is the anti-rot half — new destructive code cannot be
 *     invisible to check 2, because check 1 fails until someone lists it.
 *  2. GATING: every UI-side call (all .tsx, plus .ts under features/, hooks/,
 *     components/, entrypoints/) to a registered operation sits inside a
 *     confirmed callback.
 *
 * PROVEN FAILING-THEN-PASSING on 2026-09-12: against the tree at d43c8b7
 * (primitive landed, surfaces untouched) check 2 reported 18 unguarded call
 * sites across GuidanceView, HighlightView, ListsHubView, TaskPanel,
 * RecorderPane, PatternsTab, ScreenshotsView, VaultView, SettingsView and
 * BridgesView, plus the on-page highlighter's clear-all through
 * use-highlight-bridge; on the fixed tree it is green.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { DESTRUCTIVE_OPERATIONS, INTERNAL_ONLY } from '../../src/lib/destructive/operations';

const REPO = join(__dirname, '..', '..');
const SRC = join(REPO, 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function each(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => each(c, visit));
}

/** `a.b.c` as written, or the identifier text. */
function calleeText(expr: ts.Expression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    return `${calleeText(expr.expression)}.${expr.name.text}`;
  }
  return '';
}

/** The last segment of a callee path — the function actually being invoked. */
function calleeName(expr: ts.Expression): string {
  const text = calleeText(expr);
  return text.slice(text.lastIndexOf('.') + 1);
}

/**
 * The name of the nearest enclosing function-like thing: a declaration, a
 * `const x = () => {}`, an object method, or a class method. This is what a
 * human would call "the function this line is in".
 */
function enclosingFunctionName(node: ts.Node): string | null {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
      const p = n.parent;
      if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
      // `useCallback(async () => {…}, [])` assigned to a const
      if (ts.isCallExpression(p)) {
        const pp = p.parent;
        if (ts.isVariableDeclaration(pp) && ts.isIdentifier(pp.name)) return pp.name.text;
      }
    }
  }
  return null;
}

const line = (sf: ts.SourceFile, n: ts.Node) =>
  sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

// ---------------------------------------------------------------------------
// 1. DISCOVERY — every permanent removal in src/ is in the registry.
// ---------------------------------------------------------------------------

/**
 * A call that permanently removes persisted data. Supabase `.delete()`,
 * chrome.storage / localStorage removals, and the vault's HTTP DELETE.
 * Deliberately narrow: it must not fire on reads or on in-memory state, or
 * the registry fills with noise and stops meaning anything.
 */
function isRemovalPrimitive(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const text = calleeText(node.expression);
  if (/^chrome\.storage\.(local|session|sync|managed)\.(remove|clear)$/.test(text)) return true;
  if (/^(window\.)?localStorage\.(removeItem|clear)$/.test(text)) return true;
  if (/^indexedDB\.deleteDatabase$/.test(text)) return true;
  if (text === 'vaultDelete') return true;
  // Supabase query builders: `…from('t').delete()`. `.delete` on anything is
  // rare enough in this codebase that the last-segment match is safe.
  if (text.endsWith('.delete') && node.arguments.length === 0) return true;
  return false;
}

const REGISTERED = new Set<string>([
  ...DESTRUCTIVE_OPERATIONS.map((o) => o.fn.slice(o.fn.lastIndexOf('.') + 1)),
  ...INTERNAL_ONLY.map((o) => o.fn),
]);

describe('destructive operations are all registered', () => {
  const found: { fn: string; file: string; line: number }[] = [];
  for (const file of walk(SRC)) {
    const sf = parse(file);
    each(sf, (n) => {
      if (!isRemovalPrimitive(n)) return;
      const fn = enclosingFunctionName(n);
      if (!fn) return;
      found.push({ fn, file: relative(REPO, file), line: line(sf, n) });
    });
  }

  it('finds the removal primitives it is meant to guard', () => {
    // If this collapses the scan has stopped guarding anything.
    expect(found.length).toBeGreaterThanOrEqual(12);
  });

  it('every function that permanently removes data is in the registry', () => {
    const unregistered = found
      .filter((f) => !REGISTERED.has(f.fn))
      .map(
        (f) =>
          `${f.file}:${f.line}: \`${f.fn}\` removes data but is not in src/lib/destructive/operations.ts. ` +
          `Add it to DESTRUCTIVE_OPERATIONS (and confirm its UI call sites) or to INTERNAL_ONLY with a reason.`,
      );
    expect(unregistered, unregistered.join('\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. GATING — every .tsx call to a registered operation is confirmed.
// ---------------------------------------------------------------------------

const UI_ENTRY_POINTS = new Set(DESTRUCTIVE_OPERATIONS.flatMap((o) => o.uiEntryPoints));

/**
 * Names this file hands to a `<ConfirmDialog onConfirm={…} />`. A call sitting
 * inside one of those functions has already been confirmed.
 */
function confirmedCallbackNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  each(sf, (n) => {
    if (!ts.isJsxAttribute(n)) return;
    if (n.name.getText(sf) !== 'onConfirm') return;
    const init = n.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression) return;
    each(init.expression, (inner) => {
      if (ts.isIdentifier(inner)) names.add(inner.text);
    });
  });
  return names;
}

/** True when the call sits inside a confirmation's own callback. */
function isConfirmed(node: ts.Node, sf: ts.SourceFile, confirmedNames: Set<string>): boolean {
  // A registered wrapper (`deleteGuidance` calling `deleteGuidanceItem`) is
  // gated at ITS callers, since it is itself an entry point.
  const enclosing = enclosingFunctionName(node);
  if (enclosing && UI_ENTRY_POINTS.has(enclosing)) return true;
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    // `confirmDestructive({ …, run: () => { … } })`
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'run') {
      const obj = n.parent;
      const call = obj.parent;
      if (ts.isCallExpression(call) && calleeName(call.expression) === 'confirmDestructive') {
        return true;
      }
    }
    // `<ConfirmDialog onConfirm={() => { … }} />`
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'onConfirm') return true;
    // `const performDelete = …` where `onConfirm={performDelete}`
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && confirmedNames.has(n.name.text)) {
      return true;
    }
    if (ts.isFunctionDeclaration(n) && n.name && confirmedNames.has(n.name.text)) return true;
  }
  return false;
}

describe('destructive controls confirm before they destroy', () => {
  const offenders: string[] = [];
  let callSites = 0;

  // Every UI-side file: all .tsx, plus the .ts under features/, hooks/,
  // components/ and entrypoints/ — a confirm helper or a message bridge is
  // where a button's click actually reaches the operation. `src/lib` is the
  // operations' own home (and the tool handlers, which the agent permission
  // gate covers) and is excluded on purpose.
  const UI_SIDE = ['features', 'hooks', 'components', 'entrypoints'].map((d) => join(SRC, d));
  const scanned = walk(SRC).filter(
    (f) => f.endsWith('.tsx') || UI_SIDE.some((d) => f.startsWith(`${d}/`)),
  );
  for (const file of scanned) {
    const sf = parse(file);
    const confirmedNames = confirmedCallbackNames(sf);
    each(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const name = calleeName(n.expression);
      if (!UI_ENTRY_POINTS.has(name)) return;
      callSites += 1;
      if (isConfirmed(n, sf, confirmedNames)) return;
      offenders.push(
        `${relative(REPO, file)}:${line(sf, n)}: \`${name}()\` destroys data on a click with no confirmation. ` +
          `Wrap it in confirmDestructive({ consequence, confirmLabel, run }) from @/lib/destructive/confirm.`,
      );
    });
  }

  it('is actually looking at the destructive call sites', () => {
    // The registry lists 19 operations; if the scan finds almost none, the
    // entry-point names have drifted and this test has become a no-op.
    expect(callSites).toBeGreaterThanOrEqual(18);
  });

  it('no UI-side code reaches a destructive operation outside a confirmation', () => {
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
