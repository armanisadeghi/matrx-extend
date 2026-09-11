#!/usr/bin/env tsx
/**
 * check:swallowed-refusals — a database refusal is never swallowed into a
 * console warning.
 *
 * THE SHAPE THIS GUARD OUTLAWS (the DD-092 defect class):
 *
 *     if (error) {
 *       console.warn('[x] listThings error', error.message);
 *       return [];                      // ← the lie
 *     }
 *
 * `return []` after a failed read tells the user "you have nothing" — a
 * sentence about their data that the database never said. `return null` /
 * `false` / `0` after a failed write tells the caller "there is nothing to
 * report" while the row it thinks it saved does not exist. And `console.warn`
 * goes to a devtools console nobody has open, so no human and no error store
 * ever hears about it.
 *
 * The fix is `failDbCall()` in `src/lib/supabase/db-failure.ts`: classify,
 * tell the user in a sentence with a remedy, record it through the platform's
 * `log_client_error` RPC, and throw.
 *
 * WHY A RATCHET AND NOT A CLEAN BILL
 *
 * DD-092 converted the capture, highlight and dataset paths. 40-odd sibling
 * sites remain in the other query modules, and converting them all in one
 * commit would be a change nobody could review. So this guard is a RATCHET:
 * every remaining site is counted per file in `BUDGET` below, the build fails
 * the moment a 49th appears, and it also fails when a file drops below its
 * budget without the number being lowered — so the count can only ever go
 * down. A budget is a debt register, never a permission slip.
 *
 * WHAT IT DELIBERATELY DOES NOT FAIL ON
 *
 *   • `console.*` with no success-shaped return under it (a warning about
 *     something that is genuinely not a failure).
 *   • A `return` of a real value, a thrown error, or `failDbCall(...)`.
 *   • Anything outside the Supabase query modules in SCOPE — this is a guard
 *     about database answers, not about logging.
 *   • A declared, reasoned exemption: `// swallow-exempt: <20+ char reason>`
 *     on the console line or the line above it.
 *
 * WHAT IT CANNOT SEE — say so; never let green imply more than it proves.
 *
 *   It is a text scan. A swallow spread across a helper (`return safe(error)`)
 *   reads green here. It proves the SHAPE is gone from these files, never that
 *   every refusal in the extension reaches a human — that is what
 *   `tests/unit/db-refusal-seam.test.ts` and the live recipe in
 *   `docs/feature-tests.md` are for.
 *
 * Run:            pnpm check:swallowed-refusals
 * Prove it works: pnpm check:swallowed-refusals:self-test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * The database-answer modules. Everything here talks to Supabase and returns
 * an answer a human acts on.
 */
const SCOPE = [
  'src/lib/supabase',
  'src/lib/highlights',
  'src/lib/notes',
  'src/lib/agenda',
  'src/lib/data-pattern',
  'src/lib/lists',
];

/**
 * A file is in scope only if it actually talks to Supabase. A `console.warn` +
 * `return false` around a Chrome API is a different question with a different
 * answer (this repo's convention: feature-detect and report `unavailable`), and
 * pulling it in here would make the guard noisy enough to get deleted.
 */
const TOUCHES_SUPABASE = /@\/lib\/supabase\/(client|schemas)|supabaseClient|createClient\(/;

/**
 * Sites still swallowing, per file, as censused on 2026-09-11 (DD-092).
 * Convert a site → lower the number in the same commit. A file at 0 can be
 * deleted from this map. Adding a file or raising a number needs Arman's
 * ruling, not a build fix.
 */
const BUDGET: Record<string, number> = {
  // patterns, SEO audits, screenshots, guidance, demos, admin check, models
  'src/lib/supabase/queries.ts': 27,
  // the six highlight READ paths (every write is on the seam)
  'src/lib/highlights/queries.ts': 6,
  'src/lib/notes/queries.ts': 7,
  'src/lib/agenda/queries.ts': 8,
};

/**
 * Already honest, for the record, so nobody "fixes" them: `user-profile.ts`
 * returns `{ ok: false, error }` on every failure, and `data-pattern/recipes.ts`
 * has no swallow shape at all.
 */

/** A return whose value tells the caller "all fine, there is just nothing". */
const SUCCESS_SHAPED_RETURN =
  /^\s*return\s+(null|\[\]|\{\}|false|true|0|-1|undefined)\s*(?:as\s+[^;]+)?;/;

const CONSOLE_CALL = /\bconsole\s*\.\s*(warn|error|log|info|debug)\s*\(/;
const EXEMPT = /swallow-exempt:\s*\S.{19,}/;

export interface Finding {
  file: string;
  line: number;
  reason: string;
}

/** Every `.ts`/`.tsx` file under the scoped directories. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    let entries: string[];
    try {
      entries = readdirSync(path.join(ROOT, rel));
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = `${rel}/${entry}`;
      const full = path.join(ROOT, child);
      if (statSync(full).isDirectory()) {
        walk(child);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(child);
      }
    }
  };
  for (const dir of SCOPE) walk(dir);
  return out.sort();
}

/**
 * Find every `console.*` whose block ends in a success-shaped return. The
 * return must follow within five lines — the swallow shape is always tight,
 * and a wider window starts pairing unrelated statements.
 */
export function scanFile(file: string, source: string): Finding[] {
  const lines = source.split('\n');
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!CONSOLE_CALL.test(line)) continue;
    // Comment lines (this file's own prose, a doc block) are not code.
    if (/^\s*(\*|\/\/)/.test(line)) continue;
    if (EXEMPT.test(line) || EXEMPT.test(lines[i - 1] ?? '')) continue;
    for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
      const next = lines[j] ?? '';
      if (CONSOLE_CALL.test(next)) break; // a new statement pairs with its own return
      if (SUCCESS_SHAPED_RETURN.test(next)) {
        findings.push({
          file,
          line: i + 1,
          reason: `console.${(CONSOLE_CALL.exec(line) ?? [])[1]} + \`${next.trim()}\` — a failure answered with a success-shaped value`,
        });
        break;
      }
    }
  }
  return findings;
}

// ── self-test fixtures ──────────────────────────────────────────────────────

const RED_READ = `
if (error) {
  console.warn('[notes] listMyNotes error', error.message);
  return [];
}
`;

const RED_WRITE = `
  if (error) {
    console.error('[x] save failed', error.message);
    return null;
  }
`;

const RED_BOOLEAN = `
if (error) {
  console.warn('[x] delete failed', error.message);
  return false;
}
`;

const RED_MULTILINE_CONSOLE = `
if (error) {
  console.warn(
    '[x] append failed',
    error.message,
  );
  return 0;
}
`;

const GREEN_THROWS = `
if (error) {
  console.warn('[x] about to fail loudly', error.message);
  failDbCall(site, error);
}
`;

const GREEN_REAL_VALUE = `
if (error) {
  console.warn('[x] partial result', error.message);
  return rows;
}
`;

const GREEN_NO_CONSOLE = `
if (error) {
  return [];
}
`;

const GREEN_EXEMPT = `
if (error) {
  // swallow-exempt: a cache probe; absence and failure are the same answer here
  console.warn('[x] cache probe miss', error.message);
  return null;
}
`;

const GREEN_FAR_APART = `
console.warn('[x] starting a long operation');
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
return null;
`;

function selfTest(): void {
  const failures: string[] = [];
  const expectRed = (name: string, source: string) => {
    if (scanFile('self-test.ts', source).length === 0) {
      failures.push(
        `${name}: the detector stayed GREEN on a real swallow — a guard that cannot fail proves nothing.`,
      );
    }
  };
  const expectGreen = (name: string, source: string) => {
    const found = scanFile('self-test.ts', source);
    if (found.length > 0) {
      failures.push(
        `${name}: false positive — ${found[0]?.reason}. False positives get guards deleted.`,
      );
    }
  };

  expectRed('READ-EMPTY-ARRAY', RED_READ);
  expectRed('WRITE-NULL', RED_WRITE);
  expectRed('DELETE-FALSE', RED_BOOLEAN);
  expectRed('MULTILINE-CONSOLE', RED_MULTILINE_CONSOLE);
  expectGreen('THROWS', GREEN_THROWS);
  expectGreen('REAL-VALUE', GREEN_REAL_VALUE);
  expectGreen('NO-CONSOLE', GREEN_NO_CONSOLE);
  expectGreen('DECLARED-EXEMPTION', GREEN_EXEMPT);
  expectGreen('UNRELATED-RETURN', GREEN_FAR_APART);

  if (failures.length > 0) {
    console.error('\n🚨 check:swallowed-refusals SELF-TEST FAILED\n');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }

  console.log(
    '✅ self-test: RED on `console.warn` + `return []` / `null` / `false`, and on a\n' +
      '   multi-line console call before `return 0`; GREEN on a warn that then calls\n' +
      '   failDbCall, on a real returned value, on a bare return with no console, on a\n' +
      '   declared `swallow-exempt:` reason, and on a return five statements away.',
  );
}

function main(): void {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const counts = new Map<string, Finding[]>();
  for (const file of sourceFiles()) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    if (!TOUCHES_SUPABASE.test(source)) continue;
    const found = scanFile(file, source);
    if (found.length > 0) counts.set(file, found);
  }

  const over: string[] = [];
  const under: string[] = [];
  for (const [file, found] of counts) {
    const budget = BUDGET[file] ?? 0;
    if (found.length > budget) {
      over.push(
        `${file}: ${found.length} swallowed refusals, budget ${budget}\n` +
          found
            .slice(budget)
            .map((f) => `      line ${f.line} — ${f.reason}`)
            .join('\n'),
      );
    } else if (found.length < budget) {
      under.push(`${file}: ${found.length} left, budget still says ${budget}`);
    }
  }
  for (const [file, budget] of Object.entries(BUDGET)) {
    if (!counts.has(file) && budget > 0) under.push(`${file}: 0 left, budget still says ${budget}`);
  }

  if (over.length === 0 && under.length === 0) {
    const total = [...counts.values()].reduce((n, f) => n + f.length, 0);
    console.log(
      `✅ swallowed-refusals ratchet holds: ${total} known sites, none added.\n` +
        '   New database calls in these modules route failures through failDbCall()\n' +
        '   (src/lib/supabase/db-failure.ts) — the user is told, the platform error\n' +
        '   store is told, and nothing success-shaped comes back from a failed call.',
    );
    return;
  }

  if (over.length > 0) {
    console.error('\n🚨 A NEW SWALLOWED REFUSAL (DD-092)\n');
    for (const line of over) console.error(`  ✗ ${line}`);
    console.error(
      '\nA database failure answered with `null` / `[]` / `false` / `0` is a screen that\n' +
        'lies: the user is told they have nothing, or that their write worked. Route it\n' +
        'through `failDbCall(site, error)` in src/lib/supabase/db-failure.ts — it tells the\n' +
        'user in a sentence with a remedy, records the refusal through the platform\n' +
        '`log_client_error` RPC, and throws. If this really is not a failure, declare it:\n' +
        '  // swallow-exempt: <why absence and failure are the same answer here>\n',
    );
  }
  if (under.length > 0) {
    console.error('\n🚨 THE RATCHET SLIPPED — lower the budget you just paid down\n');
    for (const line of under) console.error(`  ✗ ${line}`);
    console.error(
      '\nEdit BUDGET in scripts/check-swallowed-refusals.ts to the new count in the SAME\n' +
        'commit. A budget that is not tightened when the debt is paid is an open door.\n',
    );
  }
  process.exit(1);
}

main();
