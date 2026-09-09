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
const NAME_SIGNALS = {
  fn: new RegExp(
    `(?:export\\s+)?function\\s+${NAME_PREFIX}Agent(?:Picker|Selector|Select|Dropdown)\\b`,
  ),
  const: new RegExp(
    `const\\s+${NAME_PREFIX}Agent(?:Picker|Selector|Select|Dropdown)\\b\\s*=\\s*(?:\\([^)]*\\)|[^=])*=>`,
  ),
};

const SIGNALS: readonly RegExp[] = [
  NAME_SIGNALS.fn,
  NAME_SIGNALS.const,
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

/**
 * `--self-test` — a guard you cannot demonstrate failing is not a guard.
 * Fixture 1 is the exact shape that walked through this script until
 * 2026-09-08 (a component named EXACTLY `AgentPicker` rendering its own
 * `<select>`); fixture 2 is a surface that DOES render the package picker;
 * fixture 3 is the `handleAgentSelect` handler a bare `\w*` prefix would
 * falsely flag.
 */
const SELF_TEST_RED = `
import { useState } from 'react';
export function AgentPicker({ agents }) {
  const [value, setValue] = useState('');
  return <select value={value}>{agents.map((a) => <option key={a.id}>{a.name}</option>)}</select>;
}
`;

const SELF_TEST_GREEN = `
import { AgentListDropdown } from '${CANONICAL_IMPORT}';
export function Surface() { return <AgentListDropdown consumerId="x" onSelect={() => {}} />; }
`;

const SELF_TEST_HANDLER = `
export function ChatSurface() {
  const handleAgentSelect = useCallback((agent) => open(agent.id), []);
  return <button onClick={() => handleAgentSelect({ id: '1' })}>Pick</button>;
}
`;

function selfTest(): void {
  const failures: string[] = [];
  if (!firstMatch(SELF_TEST_RED, SIGNALS)) {
    failures.push(
      'the detector did NOT flag a component named exactly `AgentPicker` — the 2026-09-08 name-prefix gap is back.',
    );
  }
  if (firstMatch(SELF_TEST_GREEN, SIGNALS)) {
    failures.push('the detector flagged a surface that DOES render the package picker.');
  }
  if (firstMatch(SELF_TEST_HANDLER, SIGNALS)) {
    failures.push('the detector flagged a plain `handleAgentSelect` callback (false positive).');
  }
  if (failures.length > 0) {
    console.error('\n🚨 check:canonical-pickers SELF-TEST FAILED\n');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log(
    '✅ self-test: RED on a bare `AgentPicker` fork, GREEN on the package picker, silent on a handler.',
  );
}

function main(): void {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const findings: Finding[] = [];

  for (const file of sourceFiles()) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');

    // Comment lines are exempt on purpose: the tombstones this adoption left
    // behind ("`fetchAgentList` was deleted, never re-add it") NAME the retired
    // symbols, and a guard that punishes its own documentation gets deleted.
    // Only CODE may not carry them.
    const exempt = EXEMPTION.test(text);
    const lines = text.split('\n');
    lines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (exempt) return;
      if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) return;
      for (const retired of RETIRED) {
        if (line.includes(retired)) {
          findings.push({
            file,
            line: index + 1,
            reason: `retired hand-rolled agent-list symbol \`${retired}\``,
          });
        }
      }
    });

    if (text.includes(CANONICAL_IMPORT) || EXEMPTION.test(text)) continue;

    const signal = firstMatch(text, SIGNALS);
    if (signal) {
      findings.push({
        file,
        line: lineFor(text, signal.index),
        reason: `agent-selection UI does not render ${CANONICAL_IMPORT}`,
      });
    }
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
