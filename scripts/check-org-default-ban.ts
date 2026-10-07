#!/usr/bin/env tsx
/**
 * check:org-default-ban — THE TERM "DEFAULT ORGANIZATION" IS RETIRED, ONLY THE
 * LOAD LADDER READS THE TWO ACCOUNT COLUMNS, AND NOTHING HOLDS A REQUEST TO ASK.
 *
 * THE RULING (Arman, 2026-10-07; STATE rules 11-14). The active organization
 * is set once at load and is never none: this device's last choice -> the
 * account's `last_active_organization_id` -> `startup_organization_id` -> the
 * first organization. Those columns choose what the window opens to and
 * nothing else; no request, feature or server reads them to decide where work
 * lands. His 2026-09-19 reason still stands: "one missed org check that should
 * have just failed turns into 50 in a month and 5,000 in a year, and suddenly
 * we don't have orgs anymore, we have a user and a default org."
 *
 * WHAT IT FAILS ON (all over a COMMENT-STRIPPED copy of each file, so
 * documentation of the retired terms is allowed and code is not):
 *
 *   1. Any read of `defaultOrganizationId` / `default_organization_id`, and the
 *      phrase "default organization" in copy or an error string. The term is
 *      retired (STATE rules 11-12): there is a last active organization and a
 *      start-up organization, nothing else.
 *   2. Any file other than `src/lib/org/active-org.ts` (the ladder) naming
 *      `last_active_organization_id` or `startup_organization_id`. Only the
 *      load ladder reads the two account columns (rules 12 and 14); the write
 *      door RPC name `set_last_active_organization` is not a column read.
 *   3. Any trace of the deleted personal/business organization type.
 *   4. The retired hold: `holdForActiveOrganizationId`,
 *      `requestOrganizationPicker`, or the picker storage key / channel.
 *      A signed-in person with a membership always has an organization; nothing
 *      asks (Arman, 2026-10-07).
 *
 * WHAT IT CANNOT SEE — a text scan over `src/`, `scripts/` and `tests/`. A
 * column fetched through a helper that spells nothing out reads green here.
 * What proves the behaviour is `tests/unit/auth-route.test.ts` (the ladder's
 * four rungs) and `src/lib/api/client-organization-ladder.test.ts` (a request
 * leaves carrying the ladder's organization without waiting).
 *
 * Run:            pnpm check:org-default-ban
 * Prove it works: pnpm check:org-default-ban:self-test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
/**
 * Every root a request can be built from. `src/` was the original scan, which
 * left `scripts/` and `tests/` — both of which build real requests and both of
 * which a re-introduction can hide in — unguarded. A guard that only watches
 * the directory the last regression happened in is a guard for that
 * regression, not for the class.
 */
const SCAN_ROOTS = ['src', 'scripts', 'tests'];

/** This guard and its planted fixtures name the banned shapes on purpose. */
const SELF = ['scripts/check-org-default-ban.ts'];

/** The ONLY files that may name the two account columns: the ladder and its tests. */
const LADDER = 'src/lib/org/active-org.ts';
const isLadderOrTest = (file: string) =>
  file === LADDER || /(^|\/)tests?\//.test(file) || /\.test\.tsx?$/.test(file);

/**
 * The ONE declared escape: `org-default-exempt: <reason, 20+ characters>` on
 * the offending line or the line above it. A test that has to PLANT the banned
 * preference in order to prove the resolver ignores it is the intended use;
 * "it was noisy" is not, which is what the 20-character reason is for. Same
 * spelling as matrx-local's `desktop/scripts/check-org-default-ban.mjs`, so one
 * sentence works in both repos.
 */
const EXEMPT = /org-default-exempt:\s*\S.{19,}/;

/**
 * Case-insensitive AND unanchored on purpose. An earlier draft required a word
 * boundary and a lowercase `default`, so `readDefaultOrganizationId(user.id)`
 * — the exact deleted helper, re-added by name — read GREEN. A guard that the
 * real regression walks past is worse than none.
 */
const SAVED_DEFAULT = /default_?organization_?id/i;
const PERSONAL_ORG_RPC = /\b(?:current_personal_org_id|ensure_personal_organization)\b/;
const PERSONAL_FLAG = /\b(?:isPersonal|is_personal)\b/;
const DEFAULT_ORG_PHRASE = /default\s+organization/i;
const ACCOUNT_COLUMNS = /\b(?:last_active_organization_id|startup_organization_id)\b/;
const RETIRED_HOLD =
  /\b(?:holdForActiveOrganizationId|requestOrganizationPicker|ORGANIZATION_PICKER_PENDING|ORGANIZATION_PICKER_REQUESTED)\b/;

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

/**
 * Blank out lines carrying a declared, reasoned exemption (and the line the
 * exemption comment sits above), preserving line count so reported numbers
 * still point at the real line.
 */
function dropExempt(source: string): string {
  const lines = source.split('\n');
  return lines
    .map((line, i) => (EXEMPT.test(line) || EXEMPT.test(lines[i - 1] ?? '') ? '' : line))
    .join('\n');
}

export function findingsIn(source: string, file: string): Finding[] {
  const out: Finding[] = [];
  const lines = stripComments(dropExempt(source)).split('\n');
  lines.forEach((line, index) => {
    const at = index + 1;
    if (SAVED_DEFAULT.test(line)) {
      out.push({
        file,
        line: at,
        reason: 'reads the account-level saved default organization preference',
      });
    }
    if (ACCOUNT_COLUMNS.test(line) && !isLadderOrTest(file)) {
      out.push({
        file,
        line: at,
        reason: `reads an account organization column outside the ladder (${LADDER})`,
      });
    }
    if (RETIRED_HOLD.test(line)) {
      out.push({ file, line: at, reason: 'uses the retired organization hold / picker' });
    }
    if (PERSONAL_ORG_RPC.test(line)) {
      out.push({ file, line: at, reason: 'calls a deleted personal-organization RPC' });
    }
    if (PERSONAL_FLAG.test(line)) {
      out.push({
        file,
        line: at,
        reason: 'reads the deleted is_personal organization type (organizations are all equal)',
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
  for (const root of SCAN_ROOTS) walk(root);
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
      'the deleted personal-organization RPC',
    ],
    [
      'src/lib/auth/signup.ts',
      "await supabase.rpc('ensure_personal_organization', { p_user_id: user.id });",
      1,
      'the deleted ensure-personal-organization RPC',
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
      1,
      'is_personal read as a label (the column is gone)',
    ],
    [
      'src/lib/org/active-org.ts',
      "  .select('id,name,is_personal')",
      1,
      'is_personal in a select list (the column is gone)',
    ],
    [
      'src/features/settings/SettingsView.tsx',
      'label: o.isPersonal ? `${o.name} (personal)` : o.name,',
      1,
      'a "(personal)" badge outside the resolver',
    ],
    [
      'src/lib/org/active-org.ts',
      '// the saved defaultOrganizationId preference never builds a request',
      0,
      'the banned name inside a comment (allowed — documentation)',
    ],
    [
      'src/lib/org/active-org.ts',
      '  const { data } = await usersDb().from("user_preferences").select("last_active_organization_id");',
      0,
      'the ladder reading the account columns (allowed in the ladder module)',
    ],
    [
      'src/lib/brand/new-sink.ts',
      '  const { data } = await usersDb().from("user_preferences").select("startup_organization_id");',
      1,
      'a second reader of the account columns outside the ladder',
    ],
    [
      'src/lib/api/client.ts',
      '  const held = await holdForActiveOrganizationId();',
      1,
      'the retired hold re-added',
    ],
    [
      'src/features/org/Picker.tsx',
      '  await requestOrganizationPicker();',
      1,
      'the retired picker request re-added',
    ],
    [
      'src/lib/org/active-org.ts',
      '  await getSupabase().schema("users").rpc("set_last_active_organization", { p_organization_id: id });',
      0,
      'the write door RPC (allowed everywhere)',
    ],
    [
      'src/lib/brand/new-sink.ts',
      '  const org = prefs.organization.defaultOrganizationId;',
      1,
      'the rung re-added in a file that did not exist before',
    ],
    [
      'tests/unit/auth-route.test.ts',
      '// org-default-exempt: planted on purpose to prove the resolver ignores it\n' +
        '  preferences: { organization: { defaultOrganizationId: ORG_A } },',
      0,
      'a declared, reasoned exemption on the line above',
    ],
    [
      'tests/unit/auth-route.test.ts',
      '  preferences: { defaultOrganizationId: ORG_A }, // org-default-exempt: noisy',
      1,
      'an exemption with no real reason',
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
      !PERSONAL_ORG_RPC.test(source) &&
      !DEFAULT_ORG_PHRASE.test(source) &&
      !ACCOUNT_COLUMNS.test(source) &&
      !RETIRED_HOLD.test(source) &&
      !PERSONAL_FLAG.test(source)
    ) {
      continue;
    }
    findings.push(...findingsIn(source, file));
  }

  if (findings.length === 0) {
    console.log(
      '✅ check:org-default-ban: nothing says "default organization", only the ladder reads the\n' +
        '   two account organization columns, and the hold / picker is gone. The organization a\n' +
        '   request acts in comes from the load ladder (src/lib/org/active-org.ts).',
    );
    return;
  }

  console.error('\n🚨 THE ORGANIZATION LADDER CONTRACT IS BROKEN\n');
  for (const f of findings) console.error(`  ✗ ${f.file}:${f.line} — ${f.reason}`);
  console.error(
    "\nArman, 2026-10-07: the active organization is set once at load — this device's last\n" +
      "choice, the account's last active organization, the start-up organization, the first\n" +
      'organization — and is never none. Only src/lib/org/active-org.ts reads the account\n' +
      'columns; nothing holds a request or asks. "Default organization" is a retired term.\n',
  );
  process.exit(1);
}

main();
