#!/usr/bin/env node
// Fixed D84/D86 mutation proof. Run only as an admitted stabilization-resource child.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (!process.env.MATRX_RESOURCE_OWNER) throw new Error('RESOURCE_PERMIT_REQUIRED');

const source = resolve('src/features/settings/SettingsView.tsx');
const test = 'src/features/settings/SettingsView.about.test.tsx';
const plant = resolve('.claude/skills/forcing-function-tests/plant.py');
const initial = readFileSync(source);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const originalHash = digest(initial);

function restored() {
  const actual = digest(readFileSync(source));
  if (actual !== originalHash) {
    throw new Error(`SOURCE_RESTORE_FAILED expected=${originalHash} actual=${actual}`);
  }
  console.log(`SOURCE_RESTORED sha256=${actual}`);
}

function run(command, args, label) {
  const child = spawnSync(command, args, { cwd: resolve('.'), encoding: 'utf8', stdio: 'pipe' });
  process.stdout.write(`PROOF_CASE ${label} exit=${child.status ?? 'signal'}\n`);
  process.stdout.write(child.stdout ?? '');
  process.stderr.write(child.stderr ?? '');
  restored();
  if (child.error || child.status !== 0) throw new Error(`PROOF_CASE_FAILED ${label}`);
}

const vitest = ['exec', 'vitest', 'run', '--maxWorkers=1', test];
const cases = [
  {
    id: 'D84-port-rejection-gut',
    old: 'await serializeStorageWrite(enginePortWritePending, () => setEnginePortOverride(nextPort));',
    replacement: 'await Promise.resolve();',
    name: 'keeps the saved port when storage rejects a replacement, then saves the retry',
  },
  {
    id: 'D86-write-order',
    old: 'const result = pending.current.then(write);',
    replacement: 'const result = write();',
    name: 'persists overlapping port choices in submission order',
  },
  {
    id: 'D86-delayed-read',
    old: 'if (enginePortInputRevision.current === inputRevision)',
    replacement: 'if (true)',
    name: 'preserves a port typed while the initial saved-port read is pending',
  },
];

try {
  run('pnpm', vitest, 'baseline-green');
  for (const fault of cases) {
    run(
      'python3',
      [
        plant,
        '--file',
        source,
        '--old',
        fault.old,
        '--new',
        fault.replacement,
        '--expect',
        'red',
        '--must-mention',
        fault.name,
        '--timeout',
        '120',
        '--',
        'pnpm',
        ...vitest,
        '-t',
        fault.name,
      ],
      fault.id,
    );
  }
  run('pnpm', vitest, 'restored-green');
} finally {
  restored();
}
