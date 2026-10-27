import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parsePnpmLock } from './check-matrx-packages.mjs';

// The host installs `@ai-matrx/chat` as an npm alias of `@ai-matrx/chat-v2`: on disk and in the lock it is chat-v2.
const real = name => (name === 'chat' ? 'chat-v2' : name);

// The real packed dependency JS must link; tsc skips the .175/.15 missing named export.
// An incomplete installed package must produce a failed release gate, never a successful no-op.
test('published Chat link gate accepts the installed artifacts and refuses a missing dist', () => {
  const script = fileURLToPath(new URL('./check-chat-package-link.mjs', import.meta.url));
  const ready = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(ready.status, 0, ready.stderr);
  const incomplete = mkdtempSync(join(tmpdir(), 'chat-incomplete-install-'));
  try {
    const refused = spawnSync(process.execPath, [script, '--package-root', incomplete], {
      encoding: 'utf8',
    });
    assert.equal(refused.status, 1, 'a missing published module must fail the gate');
    assert.match(refused.stderr, /cannot link/);
  } finally {
    rmSync(incomplete, { recursive: true, force: true });
  }
});

// The source copies deliberately match the lock and can evaluate: only origin validation can refuse them.
for (const linked of ['chat', 'summon']) {
  test(`published Chat link gate refuses workspace-linked ${linked} even with matching versions and loadable JS`, () => {
    const script = fileURLToPath(new URL('./check-chat-package-link.mjs', import.meta.url));
    const graph = parsePnpmLock(
      readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'),
    );
    const scratch = mkdtempSync(join(tmpdir(), 'chat-workspace-link-'));
    try {
      const scope = join(scratch, 'node_modules', '@ai-matrx');
      mkdirSync(scope, { recursive: true });
      for (const name of ['chat', 'summon']) {
        const root = name === linked ? join(scratch, 'workspace', name) : join(scope, real(name));
        mkdirSync(root, { recursive: true });
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({
            name: `@ai-matrx/${real(name)}`,
            version: [...graph.installed.get(`@ai-matrx/${real(name)}`).keys()][0],
            type: 'module',
          }),
        );
        if (name === 'chat') {
          const dist = join(root, 'dist', 'window-panels', 'overlays');
          mkdirSync(dist, { recursive: true });
          writeFileSync(join(dist, 'chat-overlays.js'), 'export const CHAT_OVERLAYS = [];');
        }
        if (name === linked) symlinkSync(root, join(scope, real(name)), 'dir');
      }
      if (linked === 'chat') {
        const sourceScope = join(scratch, 'workspace', 'chat', 'node_modules', '@ai-matrx');
        mkdirSync(sourceScope, { recursive: true });
        symlinkSync(join(scope, 'summon'), join(sourceScope, 'summon'), 'dir');
      }
      const refused = spawnSync(process.execPath, [script, '--package-root', join(scope, 'chat-v2')], {
        encoding: 'utf8',
      });
      assert.equal(
        refused.status,
        1,
        'workspace source cannot establish registry-artifact compatibility',
      );
      assert.match(refused.stderr, /workspace link/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}

// Dependency artifacts model Summon's real root→define export move. The guard itself stays real.
// Both installs satisfy provenance + the lock: only the actual Node ESM link distinguishes them.
test('published Chat link gate executes ESM linking after provenance checks', () => {
  const script = fileURLToPath(new URL('./check-chat-package-link.mjs', import.meta.url));
  const graph = parsePnpmLock(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  for (const entry of ['root', 'define']) {
    const scratch = mkdtempSync(join(tmpdir(), 'chat-esm-artifact-'));
    try {
      const scope = join(scratch, 'node_modules', '@ai-matrx');
      for (const name of ['chat', 'summon']) {
        const root = join(scope, real(name));
        mkdirSync(join(root, 'dist'), { recursive: true });
        writeFileSync(
          join(root, 'package.json'),
          JSON.stringify({
            name: `@ai-matrx/${real(name)}`,
            version: [...graph.installed.get(`@ai-matrx/${real(name)}`).keys()][0],
            type: 'module',
            ...(name === 'summon'
              ? {
                  exports: {
                    './package.json': './package.json',
                    './root': './dist/root.js',
                    './define': './dist/define.js',
                  },
                }
              : {}),
          }),
        );
      }
      writeFileSync(
        join(scope, 'summon', 'dist', 'root.js'),
        'export const SummonRoot = () => null;',
      );
      writeFileSync(
        join(scope, 'summon', 'dist', 'define.js'),
        'export const defineOverlay = () => spec => spec;',
      );
      const windows = join(scope, 'chat-v2', 'dist', 'window-panels', 'overlays');
      mkdirSync(windows, { recursive: true });
      writeFileSync(
        join(windows, 'chat-overlays.js'),
        `import { defineOverlay } from '@ai-matrx/summon/${entry}'; export const CHAT_OVERLAYS = [defineOverlay()({id:'run-controls'})];`,
      );
      const linked = spawnSync(process.execPath, [script, '--package-root', join(scope, 'chat-v2')], {
        encoding: 'utf8',
      });
      if (entry === 'root') {
        assert.equal(linked.status, 1, 'removed named export must fail the actual ESM import');
        assert.match(linked.stderr, /does not provide an export named 'defineOverlay'/);
      } else {
        assert.equal(linked.status, 0, linked.stderr);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
});
