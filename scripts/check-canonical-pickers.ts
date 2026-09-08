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

interface Finding {
  file: string;
  line: number;
  reason: string;
}

function sourceFiles(): string[] {
  const out = execSync(
    "git ls-files --cached --others --exclude-standard 'src/**/*.ts' 'src/**/*.tsx'",
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

function main(): void {
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

    const signal = firstMatch(text, [
      /(?:export\s+)?function\s+[A-Z]\w*Agent(?:Picker|Selector|Select|Dropdown)\b/,
      /const\s+[A-Z]\w*Agent(?:Picker|Selector|Select|Dropdown)\b\s*=\s*(?:\([^)]*\)|[^=])*=>/,
      /<SelectValue\b[^>]*placeholder\s*=\s*["'][^"']*(?:select|choose|pick)[^"']*agent/i,
      /<select\b[^>]*aria-label\s*=\s*["'][^"']*agent/i,
      /\b(?:agentOptions|availableAgents|displayAgents)\.map\s*\(/,
      /\bagents\.map\s*\(\s*\(?\s*a\w*\s*\)?\s*=>\s*\(?\s*\{?\s*value:/,
    ]);
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
