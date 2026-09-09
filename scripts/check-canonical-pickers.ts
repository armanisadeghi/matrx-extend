#!/usr/bin/env tsx
/**
 * check:canonical-pickers — stop agent-picker forks at source.
 *
 * THERE IS ONE AGENT PICKER on this platform and it is
 * `@ai-matrx/agents/catalog/react` (`AgentListDropdown` /
 * `AgentListInlinePicker`). This repo shipped TWO near-identical hand-rolled
 * pickers (`ChatView`'s `AgentPicker`, `PilotView`'s `PilotAgentPicker`) plus a
 * Settings `PillSelect` and a showcase `<select>`, each with its own membership
 * rule, order and filters — which is exactly how one client's list stops
 * matching another's. They were deleted on 2026-09-08; this is the guard that
 * keeps them deleted.
 *
 * Ported from matrx-frontend `scripts/check-canonical-pickers.ts` — same
 * heuristics, re-pointed at the package import. The model half of that script
 * is not ported: this repo has no `ai.model_definition` picker (its model
 * choice is a curated preset list in `lib/agents/model-presets.ts`).
 *
 * A surface that legitimately is NOT a platform agent choice declares a nearby
 * `canonical-agent-picker-exempt: <reason>` comment (12+ characters of reason).
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_IMPORT = '@ai-matrx/agents/catalog/react';
const EXEMPTION = /canonical-agent-picker-exempt:\s*(.{12,})/;

/**
 * Names this repo used for its own agent list. Any of them reappearing means a
 * second catalogue is being built. `agx_get_list` covers the RPC itself: the
 * package is the ONLY caller of it now, in any Matrx client.
 */
const RETIRED = [
  'PilotAgentPicker',
  'filterAgentsByScope',
  'fetchAgentList',
  'fetchUserAgents',
  'AgxAgentSchema',
  'DEFAULT_CHAT_AGENT',
  'agentScopes',
  'agx_get_list',
  'agx_search',
];

/**
 * 🚨 THE SUBSTRING HOLE (fixed 2026-09-08, review of P7). The canonical-import
 * test used to be `text.includes('@ai-matrx/agents/catalog/react')`, so ANY
 * mention of the path whitelisted the WHOLE file — a tombstone comment, a doc
 * line, a string. A file could name the package in a comment (or import it for
 * one purpose) and hand-roll a second picker underneath it, green. Two changes
 * close it, and they are byte-identical in all four copies of this guard
 * (matrx-frontend, matrx-extend, matrx-local/desktop,
 * aidream/apps/workflow-studio):
 *
 *  1. Every scan runs over a COMMENT-STRIPPED copy of the file (offsets and
 *     therefore reported line numbers are preserved), so nothing in a comment
 *     can whitelist — or trip — the guard. This also replaces the per-line
 *     comment skip the retired-symbol sweep used to do by hand: the tombstones
 *     this adoption left behind NAME the retired symbols, and a guard that
 *     punishes its own documentation gets deleted.
 *  2. The import test matches a real `import … from "<path>"` /
 *     `export … from "<path>"` / `require("<path>")` / `import("<path>")`
 *     statement, never a substring.
 *
 * The EXEMPTION is read from the RAW text: an exemption IS a comment.
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

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importSignals(modulePath: string): RegExp[] {
  const quoted = `['"\`]${escapeForRegExp(modulePath)}['"\`]`;
  return [
    // `import X from "p"`, `import { X } from "p"` (multi-line included), `import "p"`
    new RegExp(`\\bimport\\s+(?:[^;'"\`]*?\\bfrom\\s*)?${quoted}`),
    // `export { X } from "p"`, `export * from "p"`
    new RegExp(`\\bexport\\s+[^;'"\`]*?\\bfrom\\s*${quoted}`),
    new RegExp(`\\brequire\\s*\\(\\s*${quoted}`),
    new RegExp(`\\bimport\\s*\\(\\s*${quoted}`),
  ];
}

const IMPORT_SIGNALS = importSignals(CANONICAL_IMPORT);

/**
 * WHAT A CANONICAL IMPORT EXCUSES: rendering the package's own components, and
 * nothing else. A file that imports the package is STILL scanned. A
 * hand-rolled `Agent(Picker|Selector|Select|Dropdown)` definition is excused
 * only when the file actually renders `AgentListDropdown` /
 * `AgentListInlinePicker` (the thin-wrapper shape — a wrapper named
 * `AgentPicker.tsx` that renders the package component is fine). A hand-built
 * roster (`agentOptions|availableAgents|displayAgents`.map, a native `<select>`
 * of agents) is a finding EITHER WAY: rendering the package once does not buy
 * the right to fork a second list beneath it.
 */
const PACKAGE_RENDER = /<\s*(?:AgentListDropdown|AgentListInlinePicker)\b/;

/**
 * 🚨 THE NAME-PREFIX GAP (fixed 2026-09-08, P7). The matrx-frontend original
 * these patterns came from read `[A-Z]\w*Agent(?:Picker|…)`, which REQUIRES a
 * character BEFORE "Agent" — so a component named exactly `AgentPicker` (what
 * matrx-local shipped for months) walked straight through it, in every repo
 * that copied it. The prefix is now optional. It stays a NAMED prefix class and
 * not a bare `\w*`, because `\w*` also matches the handler name every one of
 * these surfaces has — `handleAgentSelect` — which flagged four innocent files
 * in matrx-frontend when the bare form was tried there.
 */
const NAME_PREFIX = '(?:[A-Z]\\w*|use|fetch|get|load|build|create)?';
const NAME_SIGNALS: readonly RegExp[] = [
  new RegExp(
    `(?:export\\s+)?function\\s+${NAME_PREFIX}Agent(?:Picker|Selector|Select|Dropdown)\\b`,
  ),
  new RegExp(
    `const\\s+${NAME_PREFIX}Agent(?:Picker|Selector|Select|Dropdown)\\b\\s*=\\s*(?:\\([^)]*\\)|[^=])*=>`,
  ),
];

const ROSTER_SIGNALS: readonly RegExp[] = [
  /<SelectValue\b[^>]*placeholder\s*=\s*["'][^"']*(?:select|choose|pick)[^"']*agent/i,
  /<select\b[^>]*aria-label\s*=\s*["'][^"']*agent/i,
  /\b(?:agentOptions|availableAgents|displayAgents)\.map\s*\(/,
  /\bagents\.map\s*\(\s*\(?\s*a\w*\s*\)?\s*=>\s*\(?\s*\{?\s*value:/,
];

interface Finding {
  file: string;
  line: number;
  reason: string;
}

/** A file as written (`raw`) and with comments blanked out (`code`). */
interface FileText {
  raw: string;
  code: string;
}

function readFileText(absolutePath: string): FileText {
  const raw = readFileSync(absolutePath, 'utf8');
  return { raw, code: stripComments(raw) };
}

function sourceFiles(): string[] {
  // 🚨 `src/**/*.tsx` does NOT mean "everything under src" to git: its pathspec
  // globbing let `src/**/*.tsx` match only depth-3-and-deeper paths, so a file
  // sitting directly at `src/AgentPicker.tsx` was never scanned (proven with a
  // probe, 2026-09-08). `src/*.tsx` is the recursive form here — git's `*`
  // crosses `/`.
  const out = execSync(
    "git ls-files --cached --others --exclude-standard 'src/*.ts' 'src/*.tsx'",
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  // `git ls-files --cached` still lists a file that has been deleted in the
  // working tree but not yet staged — reading it would crash the guard.
  return out
    .split('\n')
    .filter(Boolean)
    .filter((file) => existsSync(path.join(ROOT, file)));
}

function lineFor(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split('\n').length;
}

function firstMatch(text: string, patterns: readonly RegExp[]): { index: number } | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return { index: match.index };
  }
  return null;
}

/** Findings for one file. Detection reads `code`; the exemption reads `raw`. */
function scan({ raw, code }: FileText): { line: number; reason: string }[] {
  if (EXEMPTION.test(raw)) return [];
  const canonical = IMPORT_SIGNALS.some((pattern) => pattern.test(code));
  const wrapsCanonical = canonical && PACKAGE_RENDER.test(code);

  const findings: { line: number; reason: string }[] = [];

  code.split('\n').forEach((line, index) => {
    for (const retired of RETIRED) {
      if (line.includes(retired)) {
        findings.push({
          line: index + 1,
          reason: `retired hand-rolled agent-list symbol \`${retired}\``,
        });
      }
    }
  });

  const named = firstMatch(code, NAME_SIGNALS);
  if (named && !wrapsCanonical) {
    findings.push({
      line: lineFor(code, named.index),
      reason: canonical
        ? 'defines its own agent picker beside the canonical import without rendering AgentListDropdown / AgentListInlinePicker'
        : `agent-selection UI does not render ${CANONICAL_IMPORT}`,
    });
  }
  const roster = firstMatch(code, ROSTER_SIGNALS);
  if (roster) {
    findings.push({
      line: lineFor(code, roster.index),
      reason: canonical
        ? 'builds its own agent roster beside the canonical import (importing the package excuses rendering its components, nothing else)'
        : `agent-selection UI does not render ${CANONICAL_IMPORT}`,
    });
  }
  return findings;
}

/**
 * `--self-test` — a guard you cannot demonstrate failing is not a guard.
 * RED 1 is the shape that walked through this script until 2026-09-08 morning
 * (a component named EXACTLY `AgentPicker` rendering its own `<select>`);
 * RED 2 and RED 3 are the substring hole the P7 review found — a file whose
 * ONLY mention of the package is a comment, and a file that imports the package
 * for one purpose and forks a second picker beneath it. GREEN 1 renders the
 * package picker; GREEN 2 is a thin wrapper NAMED `AgentPicker` that renders it
 * (legitimate — the name is not the defect, the second roster is); the handler
 * fixture is the `handleAgentSelect` false positive a bare `\w*` prefix brings
 * back.
 */
const SELF_TEST_RED_BARE_FORK = `
import { useState } from 'react';
export function AgentPicker({ agents }) {
  const [value, setValue] = useState('');
  return <select value={value}>{agents.map((a) => <option key={a.id}>{a.name}</option>)}</select>;
}
`;

const SELF_TEST_RED_COMMENT_MENTION = `
import { useState } from 'react';
// The platform picker lives in ${CANONICAL_IMPORT} and we should adopt it some
// day; AgentListDropdown does most of this already.
export function ChooseAgent({ agents }) {
  const [value, setValue] = useState('');
  return (
    <select aria-label="Select agent" value={value}>
      {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}
`;

const SELF_TEST_RED_IMPORT_AND_FORK = `
import { AgentListDropdown } from '${CANONICAL_IMPORT}';
export function AgentSurface() { return <AgentListDropdown consumerId="x" onSelect={() => {}} />; }
export function AgentPicker({ availableAgents, onPick }) {
  return (
    <select onChange={(e) => onPick(e.target.value)}>
      {availableAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}
`;

const SELF_TEST_GREEN = `
import { AgentListDropdown } from '${CANONICAL_IMPORT}';
export function Surface() { return <AgentListDropdown consumerId="x" onSelect={() => {}} />; }
`;

const SELF_TEST_GREEN_WRAPPER = `
import { AgentListInlinePicker } from '${CANONICAL_IMPORT}';
export function AgentPicker({ onSelect }) {
  return <AgentListInlinePicker consumerId="chat" onSelect={onSelect} />;
}
`;

const SELF_TEST_HANDLER = `
export function ChatSurface() {
  const handleAgentSelect = useCallback((agent) => open(agent.id), []);
  return <button onClick={() => handleAgentSelect({ id: '1' })}>Pick</button>;
}
`;

function selfTest(): void {
  const failures: string[] = [];
  const check = (fixture: string) => scan({ raw: fixture, code: stripComments(fixture) });

  if (check(SELF_TEST_RED_BARE_FORK).length === 0) {
    failures.push(
      'RED 1: the detector did NOT flag a component named exactly `AgentPicker` — the 2026-09-08 name-prefix gap is back.',
    );
  }
  if (check(SELF_TEST_RED_COMMENT_MENTION).length === 0) {
    failures.push(
      'RED 2: the detector did NOT flag a hand-rolled <select> picker in a file whose ONLY mention of the package is a comment — the substring hole is back.',
    );
  }
  if (check(SELF_TEST_RED_IMPORT_AND_FORK).length === 0) {
    failures.push(
      'RED 3: the detector did NOT flag a file that imports the package AND forks its own `AgentPicker` beneath it — a canonical import excuses rendering the package components, nothing else.',
    );
  }
  if (check(SELF_TEST_GREEN).length > 0) {
    failures.push('GREEN 1: the detector flagged a surface that DOES render the package picker.');
  }
  if (check(SELF_TEST_GREEN_WRAPPER).length > 0) {
    failures.push(
      'GREEN 2: the detector flagged a thin wrapper named `AgentPicker` that renders AgentListInlinePicker — the name is not the defect, a second roster is.',
    );
  }
  if (check(SELF_TEST_HANDLER).length > 0) {
    failures.push('HANDLER: the detector flagged a plain `handleAgentSelect` callback (false positive).');
  }
  if (failures.length > 0) {
    console.error('\n🚨 check:canonical-pickers SELF-TEST FAILED\n');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    '✅ self-test: RED on a bare `AgentPicker` fork, on a comment-only package mention beside a\n' +
      '   <select> picker, and on a canonical import with a fork beneath it; GREEN on the package\n' +
      '   picker and on a thin `AgentPicker` wrapper; silent on a `handleAgentSelect` handler.',
  );
}

function main(): void {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const findings: Finding[] = [];

  for (const file of sourceFiles()) {
    const text = readFileText(path.join(ROOT, file));
    for (const finding of scan(text)) findings.push({ file, ...finding });
  }

  if (findings.length === 0) {
    console.log('✅ Canonical picker holds: no alternate agent selector found in src/.');
    return;
  }

  console.error('\n🚨 ALTERNATE AGENT PICKERS FOUND\n');
  for (const finding of findings) {
    console.error(`  ✗ ${finding.file}:${finding.line} — ${finding.reason}`);
  }
  console.error(
    `\nRender AgentListDropdown / AgentListInlinePicker from ${CANONICAL_IMPORT} and add the\n` +
      'configuration prop the package already has (consumerId, visibleTabs, excludeAgentIds,\n' +
      'defaultMandateKey, …). A behaviour the package lacks is a PACKAGE change made and\n' +
      'released in the same session — never a fork here. A control that is genuinely not a\n' +
      'platform agent choice carries a nearby `canonical-agent-picker-exempt: <reason>`\n' +
      'comment with 12+ characters of reason.\n',
  );
  process.exit(1);
}

main();
