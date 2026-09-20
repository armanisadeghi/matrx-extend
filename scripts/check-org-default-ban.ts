#!/usr/bin/env tsx
/**
 * check:org-default-ban — NOTHING THAT BUILDS A REQUEST READS A "DEFAULT
 * ORGANIZATION", AND NOTHING FALLS BACK TO THE PERSONAL ONE.
 *
 * THE RULING (Arman, 2026-09-19). A "default organization" is at most a
 * per-client DISPLAY preference. The user-level saved preference
 * (`users.user_preferences → preferences.organization.defaultOrganizationId`)
 * must never participate in resolving the organization a request acts in, and
 * the personal organization is never a fallback. A client may remember the
 * organization the person SET ON THIS DEVICE; with nothing set, the request is
 * HELD, the picker is shown, they set one, and the request proceeds. In his
 * words:
 *
 *   "one missed org check that should have just failed turns into 50 in a
 *    month and 5,000 in a year, and suddenly we don't have orgs anymore, we
 *    have a user and a default org, which means we just have user now."
 *
 * So this is not a style rule — it is the ratchet that keeps the rung dead.
 * The resolver rung was deleted from `src/lib/org/active-org.ts`; a well-meant
 * "it already knows their default, just use it" is a one-line re-add, and
 * nothing else in the build would notice.
 *
 * WHAT IT FAILS ON (all three over a COMMENT-STRIPPED copy of each `src/`
 * file, so documentation of the dead rung is allowed and code is not):
 *
 *   1. Any read of `defaultOrganizationId` / `default_organization_id`.
 *   2. Any personal-organization fallback in the org resolver:
 *      `current_personal_org_id` anywhere, or `isPersonal` / `is_personal`
 *      used inside `src/lib/org/` to CHOOSE an organization (find / filter /
 *      sort / a ternary / a return) rather than to LABEL one.
 *   3. The phrase "default organization" (any case) in copy or an error
 *      string — a screen that says it teaches the concept back into the
 *      product.
 *
 * WHAT IT CANNOT SEE — say so; never let green imply more than it proves.
 * It is a text scan over `src/`. A preference fetched through a helper that
 * spells nothing out (`prefs.organization[KEY]`) reads green here, and so
 * does the same rung re-added in another repo. What proves the behaviour is
 * `tests/unit/auth-route.test.ts` (the resolver ignores a live saved
 * preference) and `src/lib/api/client-organization-hold.test.ts` (a request
 * holds and resumes with the chosen id).
 *
 * Run:            pnpm check:org-default-ban
 * Prove it works: pnpm check:org-default-ban:self-test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCAN_ROOT = 'src';
const ORG_RESOLVER_DIR = 'src/lib/org/';

/** This guard and its planted fixtures name the banned shapes on purpose. */
const SELF = ['scripts/check-org-default-ban.ts'];

/**
 * Case-insensitive AND unanchored on purpose. An earlier draft required a word
 * boundary and a lowercase `default`, so `readDefaultOrganizationId(user.id)`
 * — the exact deleted helper, re-added by name — read GREEN. A guard that the
 * real regression walks past is worse than none.
 */
const SAVED_DEFAULT = /default_?organization_?id/i;
const PERSONAL_ORG_COLUMN = /\bcurrent_personal_org_id\b/;
const PERSONAL_FLAG = /\b(?:isPersonal|is_personal)\b/;
/** Shapes that pick a row rather than describe one. */
const CHOOSES = /\b(?:find|filter|sort|some|every)\s*\(|\?\s*[^:\n]*:|\breturn\b/;
/** `isPersonal: …` / `'is_personal'` in a select list — a label, not a choice. */
const LABELS = /\b(?:isPersonal|is_personal)\s*:|['"`][^'"`]*is_personal[^'"`]*['"`]/;
const DEFAULT_ORG_PHRASE = /default\s+organization/i;

export interface Finding {
  file: string;
  line: number;
  reason: string;
}

/**
 * Blank out comments while preserving offsets, so a line number still points
 * at the real line and nothing written in prose can trip — or excuse — the
 * guard. Same technique as `scripts/check-canonical-pickers.ts`.
 */
function stripComments(text: string): string {
  const blank = (chunk: string) => chunk.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (match, lead: string) => lead + ' '.repeat(match.length - lead.length),
    );
}

export function findingsIn(source: string, file: string): Finding[] {
  const out: Finding[] = [];
  const lines = stripComments(source).split('\n');
  lines.forEach((line, index) => {
    const at = index + 1;
    if (SAVED_DEFAULT.test(line)) {
      out.push({
        file,
        line: at,
        reason: 'reads the account-level saved default organization preference',
      });
    }
    if (PERSONAL_ORG_COLUMN.test(line)) {
      out.push({ file, line: at, reason: 'falls back to the personal organization' });
    }
    if (
      file.startsWith(ORG_RESOLVER_DIR) &&
      PERSONAL_FLAG.test(line) &&
      CHOOSES.test(line) &&
      !LABELS.test(line)
    ) {
      out.push({
        file,
        line: at,
        reason: 'uses is_personal to CHOOSE an organization instead of to label one',
      });
    }
    if (DEFAULT_ORG_PHRASE.test(line)) {
      out.push({
        file,
        line: at,
        reason: 'says "default organization" in copy or an error string',
      });
    }
  });
  return out;
}

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
      const next = path.join(rel, entry);
      if (statSync(path.join(ROOT, next)).isDirectory()) {
        walk(next);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      out.push(next);
    }
  };
  walk(SCAN_ROOT);
  return out.filter((f) => !SELF.includes(f));
}

function selfTest(): number {
  const cases: [string, string, number, string][] = [
    [
      'src/lib/org/active-org.ts',
      'const preferred = prefs?.organization?.defaultOrganizationId ?? null;',
      1,
      'the deleted preference rung, re-added',
    ],
    [
      'src/lib/org/active-org.ts',
      "const { data } = await db.from('user_preferences').select('default_organization_id');",
      1,
      'the same rung spelled in snake_case',
    ],
    [
      'src/lib/org/active-org.ts',
      'return organizations.find((o) => o.isPersonal) ?? organizations[0];',
      1,
      'personal-organization fallback in the resolver',
    ],
    [
      'src/lib/org/active-org.ts',
      'const preferred = await readDefaultOrganizationId(user.id);',
      1,
      'the deleted helper re-added BY NAME (the hole the first draft had)',
    ],
    [
      'src/lib/org/active-org.ts',
      'const org = rows.find((r) => r.current_personal_org_id === user.id);',
      1,
      'the personal-organization column',
    ],
    [
      'src/features/settings/SettingsView.tsx',
      'return <p>You have not set a default organization yet.</p>;',
      1,
      'the phrase in user-facing copy',
    ],
    [
      'src/lib/org/active-org.ts',
      "throw new Error('No default organization');",
      1,
      'the phrase in an error string',
    ],
    [
      'src/lib/org/active-org.ts',
      '    isPersonal: (row as { is_personal?: unknown }).is_personal === true,',
      0,
      'is_personal read as a LABEL (allowed)',
    ],
    [
      'src/lib/org/active-org.ts',
      "  .select('id,name,is_personal')",
      0,
      'is_personal in a select list (allowed)',
    ],
    [
      'src/lib/org/active-org.ts',
      '// the saved defaultOrganizationId preference never builds a request',
      0,
      'the banned name inside a comment (allowed — documentation)',
    ],
    [
      'src/lib/org/active-org.ts',
      '  if (organizations.length === 1) return organizations[0];',
      0,
      'the sole-membership rung (allowed)',
    ],
  ];
  let bad = 0;
  for (const [file, src, expected, label] of cases) {
    const got = findingsIn(src, file).length;
    const ok = got > 0 === expected > 0;
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'ok ' : 'BAD'} ${label}: expected ${expected}, got ${got}`);
  }
  console.log(`check:org-default-ban self-test: ${bad === 0 ? 'PASS' : `FAIL (${bad})`}`);
  return bad === 0 ? 0 : 1;
}

function main(): void {
  if (process.argv.includes('--self-test')) process.exit(selfTest());

  const findings: Finding[] = [];
  for (const file of sourceFiles()) {
    let source: string;
    try {
      source = readFileSync(path.join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    if (
      !SAVED_DEFAULT.test(source) &&
      !PERSONAL_ORG_COLUMN.test(source) &&
      !DEFAULT_ORG_PHRASE.test(source) &&
      !PERSONAL_FLAG.test(source)
    ) {
      continue;
    }
    findings.push(...findingsIn(source, file));
  }

  if (findings.length === 0) {
    console.log(
      '✅ check:org-default-ban: no saved-default read, no personal-organization fallback,\n' +
        '   and nothing says "default organization". The organization a request acts in comes\n' +
        '   from what the person set ON THIS DEVICE — or the request is held and they are asked\n' +
        '   (src/lib/org/active-org.ts § holdForActiveOrganizationId).',
    );
    return;
  }

  console.error('\n🚨 A "DEFAULT ORGANIZATION" IS BACK IN THE REQUEST PATH\n');
  for (const f of findings) console.error(`  ✗ ${f.file}:${f.line} — ${f.reason}`);
  console.error(
    '\nArman, 2026-09-19: "one missed org check that should have just failed turns into 50 in\n' +
      "a month and 5,000 in a year, and suddenly we don't have orgs anymore, we have a user and\n" +
      'a default org, which means we just have user now."\n\n' +
      "The organization comes from this device's own selection, or from the sole membership, or\n" +
      'the request is HELD and the person is asked: holdForActiveOrganizationId() in\n' +
      'src/lib/org/active-org.ts. Never a saved preference, never the personal organization,\n' +
      'never "first".\n',
  );
  process.exit(1);
}

main();
