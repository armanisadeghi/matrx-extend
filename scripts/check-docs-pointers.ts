#!/usr/bin/env tsx
/**
 * check-docs-pointers.ts — doc pointer guard (advisory).
 *
 * Modeled on ai-matrx's scripts/check-docs-guards.ts pointer-path lint, kept
 * minimal for this repo: no confident-title check, no root-.md ban (those are
 * ai-matrx-specific doc-jungle rules this repo hasn't adopted).
 *
 * Scans git-tracked *.md files under docs/, the repo root, and .claude/skills/
 * for two things:
 *
 *  1. Relative in-repo links — `[text](./foo.md)` / `[text](../bar.md)` /
 *     bare relative paths in prose — that don't resolve to a real file.
 *     Anchors (`#section`) are stripped before resolution.
 *
 *  2. Cross-repo pointers of the form
 *     `/Users/armanisadeghi/code/<repo>/<path>` or `common-docs/<path>`.
 *     We can only validate the SHAPE (this machine may not have the sibling
 *     repo checked out), not existence. Shape rule: a `common-docs/` path
 *     must start with one of the canonical bundle dirs — `systems/`,
 *     `projects/`, `policies/`, `skills/`, `meta/` — per the 2026-07-22
 *     common-docs restructure that silently broke 33 flat pointers
 *     (`common-docs/foo-system/FEATURE.md` style). This guard exists to
 *     catch that class again.
 *
 * ADVISORY by default: prints a report and exits 0. `--strict` exits 1 when
 * violations exist (wire into CI / release gates when desired).
 *
 * Usage:
 *   pnpm check:docs-pointers
 *   pnpm check:docs-pointers --strict
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = process.cwd();
const STRICT = process.argv.includes('--strict');

// Only scan the doc-y parts of the repo — not node_modules, .output, archives.
const SCAN_INCLUDE = /^(docs\/|\.claude\/skills\/|[^/]+\.md$)/;
const SCAN_EXCLUDE = /^(docs\/archive\/|\.matrx\/|\.arman\/|\.cursor\/)/;

const COMMON_DOCS_ALLOWED_DIRS = new Set(['systems', 'projects', 'policies', 'meta', 'skills', 'operations']);

function trackedMd(): string[] {
  return execSync("git ls-files -z -- '*.md'", { encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && SCAN_INCLUDE.test(f) && !SCAN_EXCLUDE.test(f));
}

interface BrokenLink {
  file: string;
  line: number;
  target: string;
}

interface BadPointer {
  file: string;
  line: number;
  kind: 'shape' | 'spelling';
  text: string;
}

const brokenLinks: BrokenLink[] = [];
const badPointers: BadPointer[] = [];

// Matches markdown links: [text](target) — captures the target only.
const MD_LINK = /\[[^\]]*\]\(([^)]+)\)/g;

// Cross-repo pointer patterns.
const REPO_ABS_POINTER = /\/Users\/armanisadeghi\/code\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._/-]+)/g;
const COMMON_DOCS_RELATIVE = /(?<![\w/])common-docs\/([A-Za-z0-9._-]+)\//g;
const BAD_SPELLING = /\/Volumes\/Samsung2TB\/code\/common-docs|matrx-common-docs\//;

function isRelativeLinkTarget(target: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false; // scheme:// URL
  if (target.startsWith('#')) return false; // pure anchor
  if (target.startsWith('/Users/')) return false; // absolute cross-repo, handled separately
  if (target.startsWith('mailto:')) return false;
  return true;
}

for (const file of trackedMd()) {
  const filePath = join(ROOT, file);
  let lines: string[];
  try {
    lines = readFileSync(filePath, 'utf8').split('\n');
  } catch {
    continue;
  }
  const fileDir = dirname(filePath);

  lines.forEach((text, i) => {
    const lineNo = i + 1;

    // 1. Relative in-repo markdown links.
    for (const m of text.matchAll(MD_LINK)) {
      const raw = m[1]?.trim();
      if (!raw) continue;
      if (!isRelativeLinkTarget(raw)) continue;
      const withoutAnchor = raw.split('#')[0]?.trim();
      if (!withoutAnchor) continue; // was just an anchor
      const resolvedFromDoc = resolve(fileDir, withoutAnchor);
      // Some docs (esp. .claude/skills/) write bare relative paths meant as
      // repo-root-relative rather than doc-relative. Accept either.
      const resolvedFromRoot = resolve(ROOT, withoutAnchor);
      // A relative link that climbs out of this repo (../sibling-repo/...) is a
      // cross-repo pointer in disguise — we can only verify it if that sibling
      // repo actually exists on this machine. If it doesn't, this is the same
      // "shape only, not existence" situation as the /Users/... pointers below;
      // skip rather than false-flag it as broken.
      if (!resolvedFromDoc.startsWith(ROOT) && !resolvedFromRoot.startsWith(ROOT)) {
        const parentOfRoot = dirname(ROOT);
        const siblingRoot = resolve(parentOfRoot, withoutAnchor);
        const firstSegment = siblingRoot.slice(parentOfRoot.length + 1).split('/')[0];
        const siblingRepoDir = firstSegment ? join(parentOfRoot, firstSegment) : null;
        if (siblingRepoDir && !existsSync(siblingRepoDir)) {
          continue; // sibling repo not checked out here — unverifiable, not broken
        }
      }
      if (!existsSync(resolvedFromDoc) && !existsSync(resolvedFromRoot)) {
        brokenLinks.push({ file, line: lineNo, target: raw });
      }
    }

    // 2. Cross-repo absolute pointers — shape check only.
    for (const m of text.matchAll(REPO_ABS_POINTER)) {
      const repo = m[1];
      const subpath = m[2];
      if (repo === 'common-docs' && subpath) {
        const topDir = subpath.split('/')[0];
        if (topDir && !COMMON_DOCS_ALLOWED_DIRS.has(topDir)) {
          badPointers.push({
            file,
            line: lineNo,
            kind: 'shape',
            text: text.trim().slice(0, 160),
          });
        }
      }
    }

    // 3. Bare `common-docs/<dir>/...` pointers (no leading /Users/... prefix).
    for (const m of text.matchAll(COMMON_DOCS_RELATIVE)) {
      const topDir = m[1];
      if (topDir && !COMMON_DOCS_ALLOWED_DIRS.has(topDir)) {
        badPointers.push({
          file,
          line: lineNo,
          kind: 'shape',
          text: text.trim().slice(0, 160),
        });
      }
    }

    // 4. Known-stale spellings.
    if (BAD_SPELLING.test(text)) {
      badPointers.push({
        file,
        line: lineNo,
        kind: 'spelling',
        text: text.trim().slice(0, 160),
      });
    }
  });
}

// Dedupe badPointers (shape + spelling regexes can both fire on one line).
const seen = new Set<string>();
const dedupedPointers = badPointers.filter((p) => {
  const key = `${p.file}:${p.line}:${p.kind}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const total = brokenLinks.length + dedupedPointers.length;

if (total === 0) {
  console.log(
    'check-docs-pointers: OK — no broken relative links or malformed cross-repo pointers.',
  );
  process.exit(0);
}

console.log('');
console.log('============================================================');
console.log('  [FAIL] DOCS POINTER GUARD — broken/malformed doc pointers');
console.log('============================================================');

if (brokenLinks.length) {
  console.log('');
  console.log(`-- Broken relative in-repo links (${brokenLinks.length}) --`);
  for (const b of brokenLinks) {
    console.log(`   ${b.file}:${b.line}  -> ${b.target}`);
  }
}

if (dedupedPointers.length) {
  console.log('');
  console.log(`-- Malformed cross-repo pointers (${dedupedPointers.length}) --`);
  console.log(
    '   common-docs paths must start with systems/, projects/, policies/, meta/, skills/, or operations/',
  );
  console.log(
    '   (the 2026-07-22 restructure broke flat pointers like common-docs/foo-system/FEATURE.md).',
  );
  console.log('   Canonical spelling: /Users/armanisadeghi/code/common-docs/<dir>/...');
  console.log(
    '   NOTE: this guard checks SHAPE only for cross-repo pointers — it cannot verify the',
  );
  console.log('   target file exists on this machine, since sibling repos may not be checked out.');
  for (const p of dedupedPointers) {
    console.log(`   [${p.kind}] ${p.file}:${p.line}  ${p.text}`);
  }
}

console.log('');
console.log(
  `${total} error(s). ${STRICT ? 'Strict mode — failing.' : 'Advisory — fix at will; re-run with --strict to gate CI.'}`,
);
process.exit(STRICT ? 1 : 0);
