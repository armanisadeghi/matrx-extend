#!/usr/bin/env node
// release-matrx-catchup.mjs — the two decisions behind release.sh's @ai-matrx catch-up.
//
// aidream publishes an @ai-matrx package every few minutes, so a version can land
// between ship.sh's sync (`pnpm update -r "@ai-matrx/*" --latest`) and release.sh's
// first gate. The matrx-packages gate then fails on STALE alone and the release
// stopped, over and over (four attempts in a row on 2026-10-04). release.sh now
// catches up itself, but only when both answers below are "yes":
//
//   stale-only <check-output>
//       Is the gate's ONLY failure a plain STALE install that `pnpm update` moves?
//       Prints one `<name> <installed-version>` line per STALE package, exit 0.
//       Exit 1 when any failure is anything else (PIN, DUPLICATE, AHEAD,
//       STALE (upstream pin), unverifiable, not installed) or nothing parses —
//       those are never auto-fixed.
//
//   consumer-actions --root <dir> <name>@<old-version>...
//       After the update: does any CHANGELOG entry newer than <old-version>, up to
//       the version now installed, declare a Consumer action? Exit 0 when every new
//       entry says none; exit 1, naming each entry, when any declares one (somebody
//       has to adopt it) or when the new version has no entry to read.
//
//   --self-test   prove both decisions can go red.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?/;

export function compareVersions(a, b) {
  const pa = a.match(SEMVER)?.slice(1, 4).map(Number) ?? [0, 0, 0];
  const pb = b.match(SEMVER)?.slice(1, 4).map(Number) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The failure lines of a check-matrx-packages run (the bullets under its failure header). */
export function failureLines(output) {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => line.includes('@ai-matrx install-graph check failed:'));
  if (start === -1) return null;
  const failures = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('  - ')) failures.push(line.slice(4));
    else if (line.trim() === '' && failures.length > 0) break;
  }
  return failures;
}

/** [{name, version}] when every failure is a plain STALE; null otherwise. */
export function staleOnly(output) {
  const failures = failureLines(output);
  if (!failures || failures.length === 0) return null;
  const stale = [];
  for (const failure of failures) {
    const match = failure.match(/^STALE: (@ai-matrx\/[\w.-]+)@(\d+\.\d+\.\d+(?:-[\w.-]+)?) /);
    if (!match) return null;
    stale.push({ name: match[1], version: match[2] });
  }
  return stale;
}

/** CHANGELOG.md → [{version, body}] in file order. */
export function changelogEntries(text) {
  const entries = [];
  let current = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^## \[?v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/);
    if (heading) {
      current = { version: heading[1], body: '' };
      entries.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  return entries;
}

const SAYS_NONE = /^[-*_\s]*(none|no\b|n\/a|nothing)/i;
const UPDATE_ONLY =
  /^[-*_\s]*(update|upgrade|refresh)\b(?:[^.;]|\.(?=\d))*[.;]\s*no\b[^.]*\b(required|needed)\b/i;

/**
 * Every Consumer action an entry declares that is not "none". The changelogs are
 * prose, so this is deliberately conservative: anything it cannot read as "none"
 * is returned as an action, which stops the release for a person to look at.
 */
export function consumerActions(body) {
  const lines = body.split('\n');
  const actions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/consumer action/i.test(line)) continue;
    if (/^#+\s*consumer action/i.test(line.trim())) {
      const rest = line.replace(/^\s*#+\s*consumer action\s*(\([^)]*\))?\s*:?\s*/i, '');
      let paragraph = rest;
      if (!paragraph.trim()) {
        const following = [];
        for (const next of lines.slice(i + 1)) {
          if (/^#/.test(next)) break;
          if (next.trim() === '') {
            if (following.length > 0) break;
            continue;
          }
          following.push(next.trim());
        }
        paragraph = following.join(' ');
      }
      if (!SAYS_NONE.test(paragraph) && !UPDATE_ONLY.test(paragraph))
        actions.push(paragraph.trim() || '(empty Consumer action section)');
      continue;
    }
    if (/\bno consumer action\b/i.test(line)) continue;
    const inline = line.match(
      /consumer action[*_]*\s*(?:\([^)]*\))?\s*[*_]*\s*[:—–]\s*[*_]*\s*(.*)$/i,
    );
    if (!inline) continue; // a prose mention ("see 0.12.0's consumer action"), not a declaration
    if (!SAYS_NONE.test(inline[1])) actions.push(inline[1].trim());
  }
  return actions;
}

/** The installed copy of a package with the highest version (top level first, then the pnpm store). */
function installedCopy(root, name) {
  const candidates = [];
  const top = join(root, 'node_modules', name);
  if (existsSync(join(top, 'package.json'))) candidates.push(realpathSync(top));
  const store = join(root, 'node_modules', '.pnpm');
  const prefix = `${name.replace('/', '+')}@`;
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith(prefix)) continue;
      const dir = join(store, entry, 'node_modules', name);
      if (existsSync(join(dir, 'package.json'))) candidates.push(dir);
    }
  }
  let best = null;
  for (const dir of candidates) {
    const version = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
    if (!best || compareVersions(version, best.version) > 0) best = { dir, version };
  }
  return best;
}

export function reviewCatchUp(root, stale) {
  const problems = [];
  const summary = [];
  for (const { name, version: from } of stale) {
    const copy = installedCopy(root, name);
    if (!copy) {
      problems.push(`${name}: not installed after the update`);
      continue;
    }
    if (compareVersions(copy.version, from) <= 0) {
      problems.push(`${name}: the update left it at ${copy.version} (was ${from})`);
      continue;
    }
    const changelog = join(copy.dir, 'CHANGELOG.md');
    if (!existsSync(changelog)) {
      problems.push(
        `${name}@${copy.version}: ships no CHANGELOG.md, so its Consumer actions cannot be read`,
      );
      continue;
    }
    const entries = changelogEntries(readFileSync(changelog, 'utf8')).filter(
      (e) => compareVersions(e.version, from) > 0 && compareVersions(e.version, copy.version) <= 0,
    );
    if (!entries.some((e) => compareVersions(e.version, copy.version) === 0)) {
      problems.push(
        `${name}@${copy.version}: its CHANGELOG has no entry for ${copy.version}, so its Consumer action cannot be read`,
      );
    }
    for (const entry of entries) {
      for (const action of consumerActions(entry.body)) {
        problems.push(`${name}@${entry.version} Consumer action: ${action.slice(0, 240)}`);
      }
    }
    summary.push(
      `${name} ${from} → ${copy.version} (${entries.length} CHANGELOG entr${entries.length === 1 ? 'y' : 'ies'}, no Consumer action)`,
    );
  }
  return { problems, summary };
}

// ── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const problems = [];
  const expect = (label, actual, wanted) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      problems.push(`${label}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`);
  };
  const run = (bullets) =>
    `✓ x\n\n@ai-matrx install-graph check failed:\n${bullets.map((b) => `  - ${b}`).join('\n')}\n\nTHE LATEST LAW + ONE SYSTEM`;
  const staleLine =
    'STALE: @ai-matrx/design-system@0.61.20 is in the graph (the repo); npm latest is 0.61.21. REMEDY: pnpm update';
  expect('plain STALE is catchable', staleOnly(run([staleLine])), [
    { name: '@ai-matrx/design-system', version: '0.61.20' },
  ]);
  expect(
    'PIN beside STALE is not',
    staleOnly(run([staleLine, 'PIN: @ai-matrx/kit is declared as "1.0.0" in dependencies'])),
    null,
  );
  expect(
    'DUPLICATE is not',
    staleOnly(run(['DUPLICATE: @ai-matrx/kit is installed at 2 versions'])),
    null,
  );
  expect(
    'upstream pin is not',
    staleOnly(run(['STALE (upstream pin): @ai-matrx/kit@0.1.0 is in the graph'])),
    null,
  );
  expect(
    'unverifiable is not',
    staleOnly(run(['@ai-matrx/kit latest could not be verified against npm.'])),
    null,
  );
  expect('no output is not', staleOnly(''), null);
  expect(
    'transients are ignored',
    staleOnly(
      `\n⚠ npm is still propagating a release — reported, not failed:\n  - @ai-matrx/a@1.0.0 took\n${run([staleLine])}`,
    ),
    [{ name: '@ai-matrx/design-system', version: '0.61.20' }],
  );

  const none = [
    'No source changes intended and no consumer action required.',
    'No consumer action.',
    '**Consumer action:** none.',
    '- Consumer action: none — refresh to latest.',
    '*Consumer action:* none; `record` then leads to the',
    'Consumer action: none required; matrx-extend drops its per-org fan-out.',
    '### Consumer action\n\nNone.',
    '### Consumer action\n\n- None required.',
    '### Consumer action: none',
    '### Consumer action\n\nUpdate to 0.18.9. No host configuration changes are required.',
    "See 0.12.0's consumer action for the history.",
  ];
  for (const body of none) expect(`none: ${body.slice(0, 40)}`, consumerActions(body).length, 0);
  const action = [
    '**Consumer action:** matrx-extend and matrx-local replace their censused local copies.',
    'Consumer action: pass the registry row metadata.disposition to kindSchema.',
    '### Consumer action\n\nUpdate to 0.18.2 and provide a stable `identityKey` wherever auth runs.',
    '### Consumer action (C28)\n\nDelete your local button fork.',
  ];
  for (const body of action)
    expect(`action: ${body.slice(0, 40)}`, consumerActions(body).length, 1);

  expect(
    'entries parse',
    changelogEntries('# Changelog\n\n## 0.2.0 — x\nbody2\n## 0.1.0\nbody1\n').map((e) => e.version),
    ['0.2.0', '0.1.0'],
  );

  if (problems.length > 0) {
    console.error('release-matrx-catchup --self-test FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `✓ release-matrx-catchup self-test passed (${7 + none.length + action.length + 1} cases)`,
  );
}

// ── Entry point ──────────────────────────────────────────────────────────────

// realpath both sides: macOS reaches /var through the /private/var symlink.
if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === '--self-test') {
    selfTest();
  } else if (mode === 'stale-only') {
    const stale = rest[0] && existsSync(rest[0]) ? staleOnly(readFileSync(rest[0], 'utf8')) : null;
    if (!stale) process.exit(1);
    for (const { name, version } of stale) console.log(`${name}@${version}`);
  } else if (mode === 'consumer-actions') {
    const rootAt = rest.indexOf('--root');
    const root = rootAt === -1 ? process.cwd() : resolve(rest[rootAt + 1]);
    const stale = rest
      .filter((arg, i) => arg !== '--root' && i !== rootAt + 1)
      .map((arg) => {
        const at = arg.lastIndexOf('@');
        return { name: arg.slice(0, at), version: arg.slice(at + 1) };
      });
    const { problems, summary } = reviewCatchUp(root, stale);
    if (problems.length > 0) {
      for (const p of problems) console.log(p);
      process.exit(1);
    }
    for (const s of summary) console.log(s);
  } else {
    console.error(
      'usage: release-matrx-catchup.mjs stale-only <check-output> | consumer-actions --root <dir> <name>@<version>... | --self-test',
    );
    process.exit(2);
  }
}
