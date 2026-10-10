// Runs the real shared guard with the hosted dependency and symlink layout.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('checks frozen candidate growth through an aidream symlink with only consumer dependencies installed', () => {
  const root = mkdtempSync(join(tmpdir(), 'db-doors-hosted-'));
  roots.push(root);
  const aidream = join(root, 'checkout/aidream');
  const scripts = join(aidream, 'apps/shared/scripts');
  const candidate = join(root, 'snapshot/matrx-extend');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(candidate, { recursive: true });
  for (const file of ['check-db-doors.mjs', 'db-doors-baseline.json']) {
    copyFileSync(resolve('../aidream/apps/shared/scripts', file), join(scripts, file));
  }
  symlinkSync(aidream, join(root, 'snapshot/aidream'), 'dir');
  symlinkSync(resolve('node_modules'), join(candidate, 'node_modules'), 'dir');
  writeFileSync(join(candidate, 'package.json'), '{"private":true}');
  const file = join(candidate, 'release-candidate-probe.ts');
  writeFileSync(file, 'export const rows = [];');
  const git = (...args: string[]) => spawnSync('git', args, { cwd: candidate });
  expect(git('init', '-q').status).toBe(0);
  expect(git('add', 'release-candidate-probe.ts').status).toBe(0);
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '../aidream/apps/shared/scripts/check-db-doors.mjs',
        '--repo',
        'matrx-extend',
        '--repo-dir',
        '.',
        '--strict',
        '--json',
      ],
      { cwd: candidate, encoding: 'utf8' },
    );
  const clean = run();
  expect(clean.stderr).toBe('');
  expect(clean.status).toBe(0);
  expect(JSON.parse(clean.stdout).grown).toEqual([]);
  writeFileSync(file, 'export const rows = supabase.from("notes").select("id");');
  const planted = run();
  expect(planted.status).toBe(1);
  expect(JSON.parse(planted.stdout).grown).toEqual([
    'matrx-extend:release-candidate-probe.ts: 1 direct database call(s), baseline 0',
  ]);
  writeFileSync(file, 'export const rows = [];');
  expect(JSON.parse(run().stdout).grown).toEqual([]);
});

it('reports database growth separately from setup failures without exposing raw output', () => {
  const root = mkdtempSync(join(tmpdir(), 'db-doors-diagnosis-'));
  roots.push(root);
  const log = join(root, 'gate.log');
  const diagnose = (output: string) => {
    writeFileSync(log, output);
    return spawnSync(process.execPath, [resolve('scripts/release-db-door-diagnostics.mjs'), log], {
      encoding: 'utf8',
    }).stdout;
  };
  expect(
    diagnose(
      '  matrx-extend:src/probe.ts: 2 direct database call(s), baseline 1\nraw secret sentinel\n',
    ),
  ).toBe('db-door-growth file=src/probe.ts calls=2 baseline=1\n');
  expect(diagnose("Error: Cannot find module 'typescript'\nraw secret sentinel\n")).toBe(
    'db-door-setup=missing-typescript\n',
  );
  expect(
    diagnose(
      'matrx-extend:../outside.ts: 1 direct database call(s), baseline 0\nraw secret sentinel',
    ),
  ).toBe('db-door-failure=unrecognized-output\n');
});
