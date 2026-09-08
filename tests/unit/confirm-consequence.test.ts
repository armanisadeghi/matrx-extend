/**
 * THE GUARD FOR THE CLASS: a destructive confirmation in this repo must NAME
 * THE CONSEQUENCE.
 *
 * The platform's destructive-and-expensive-actions law (Arman, 2026-08-29;
 * `common-docs/policies/destructive-and-expensive-actions.md`) says a generic
 * "Are you sure?" does not satisfy the confirmation requirement — the text has
 * to state what is LOST, what is DUPLICATED, or what it COSTS.
 * `@ai-matrx/design-system` enforces that inside the package (its own
 * consequence-first copy contract), but the package cannot see what THIS repo
 * passes as `description`, and a call site is where the law is actually broken.
 *
 * It was broken here. When `src/components/ConfirmDialog.tsx` collapsed onto
 * the package component (census row 19i, 2026-09-08), five of the six call
 * sites named a real consequence and `AgendaView`'s did not: its title asked
 * "Delete task?" and its description asked `Delete task "<title>"?` — the same
 * question twice, naming nothing. Behind that click is a hard row delete whose
 * FKs cascade the task's triggers AND its entire run history away with it.
 *
 * A test that only checked AgendaView would let the seventh call site land, so
 * this walks EVERY `<ConfirmDialog` in src/ and fails on any destructive one
 * whose description merely re-asks the title. It fails on the pre-fix
 * AgendaView copy and passes on the current tree.
 *
 * The heuristic is deliberately narrow — it rejects a description that is only
 * an interrogative echo, not one it fails to recognise as eloquent. A dialog
 * whose description is a real sentence about what happens always passes; the
 * shape it catches is the one the law names by example.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', 'src');
const SOURCE_EXTENSIONS = ['.tsx'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

interface ConfirmUsage {
  file: string;
  line: number;
  jsx: string;
}

/**
 * Every `<ConfirmDialog … />` element in a source file, as raw JSX text.
 * Elements are self-closing at all six call sites; the scan stops at the `/>`
 * that closes the opening tag.
 */
function findConfirmDialogs(contents: string, file: string): ConfirmUsage[] {
  const out: ConfirmUsage[] = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!(lines[i] ?? '').includes('<ConfirmDialog')) continue;
    const collected: string[] = [];
    for (let j = i; j < lines.length; j += 1) {
      const line = lines[j] ?? '';
      collected.push(line);
      if (line.trimEnd().endsWith('/>')) break;
    }
    out.push({ file, line: i + 1, jsx: collected.join('\n') });
  }
  return out;
}

/**
 * The description as authored — either a string literal/template, or the JSX
 * expression body. Returns the human-readable text with markup stripped, which
 * is what a user actually reads.
 */
function descriptionText(jsx: string): string | null {
  const start = jsx.indexOf('description=');
  if (start === -1) return null;
  const after = jsx.slice(start + 'description='.length);

  // The expression must be BOUNDED. Reading to the end of the element instead
  // would drag `confirmLabel`, `onConfirm` and the closing `/>` into the text,
  // and the trailing markup would make any description look declarative — the
  // first draft of this guard did exactly that and passed the very copy it was
  // written to catch.
  let body: string;
  if (after.startsWith('{')) {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < after.length; i += 1) {
      if (after[i] === '{') depth += 1;
      else if (after[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return null;
    body = after.slice(1, end);
  } else {
    const quote = after[0];
    if (quote === undefined) return null;
    const end = after.indexOf(quote, 1);
    if (end === -1) return null;
    body = after.slice(1, end);
  }

  return body
    .replace(/<[^>]*>/g, ' ') // JSX tags — the block spans a multi-part consequence uses
    .replace(/\{[^}]*\}/g, ' ') // interpolations: `${task.title}` names no consequence
    .replace(/[`"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The law's failing shape: the description asks a question and asserts nothing.
 * "Delete task?" / "Are you sure?" / "Remove this item?" all land here; any
 * declarative clause about what happens does not.
 */
function namesNoConsequence(text: string): boolean {
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return true;
  // A consequence is stated, never asked. If EVERY sentence is a question,
  // nothing was stated.
  return sentences.every((s) => s.endsWith('?'));
}

describe('destructive confirmations name the consequence', () => {
  const usages = walk(SRC).flatMap((file) =>
    findConfirmDialogs(readFileSync(file, 'utf8'), relative(SRC, file)),
  );

  it('finds the repo ConfirmDialog call sites', () => {
    // If this drops to zero the scan has silently stopped guarding anything.
    expect(usages.length).toBeGreaterThanOrEqual(6);
  });

  it('every destructive ConfirmDialog states what happens, never only asks', () => {
    const offenders: string[] = [];
    for (const usage of usages) {
      if (!usage.jsx.includes('variant="destructive"')) continue;
      const text = descriptionText(usage.jsx);
      if (text === null) {
        offenders.push(`${usage.file}:${usage.line}: destructive confirm has no description`);
        continue;
      }
      if (namesNoConsequence(text)) {
        offenders.push(`${usage.file}:${usage.line}: description asks but never states: "${text}"`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('recognises the AgendaView copy this guard was written for', () => {
    // The pre-fix text, pinned so the detector cannot rot into a no-op that
    // passes everything. This is the exact string the law would have caught.
    expect(namesNoConsequence('Delete task "Weekly digest"?')).toBe(true);
    expect(namesNoConsequence('Are you sure?')).toBe(true);
    expect(
      namesNoConsequence(
        'The schedule and every run this task has recorded are permanently deleted. This cannot be undone.',
      ),
    ).toBe(false);
  });
});
