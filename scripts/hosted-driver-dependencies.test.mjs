import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { lockedHostedTypeScript } from './hosted-driver-dependencies.mjs';

const repo = resolve(import.meta.dirname, '..');

test('hosted D47 entry imports with only its isolated locked runtime dependencies', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'd47-hosted-import-'));
  try {
    const checkout = join(scratch, 'checkout');
    const runtime = join(scratch, 'runtime');
    await cp(join(repo, 'scripts'), join(checkout, 'scripts'), { recursive: true });
    await cp(join(repo, 'tests/browser'), join(checkout, 'tests/browser'), { recursive: true });
    await writeFile(join(checkout, 'package.json'), '{"type":"module"}\n');
    const entry = join(checkout, 'tests/browser/showcase-d47-document-lifecycle.mjs');
    const modulePath = join(runtime, 'node_modules/typescript/lib/typescript.js');
    const env = {
      ...process.env,
      MATRX_D47_IMPORT_PREFLIGHT: '1',
      MATRX_TYPESCRIPT_MODULE: modulePath,
    };
    const run = () =>
      spawnSync(process.execPath, [entry], {
        cwd: checkout,
        env,
        encoding: 'utf8',
        timeout: 30000,
      });
    const red = run();
    assert.notEqual(red.status, 0);
    assert.match(red.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.match(red.stderr, /typescript\.js/);
    const installed = spawnSync(
      'npm',
      [
        'install',
        '--prefix',
        runtime,
        '--no-save',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        'playwright-core@1.56.1',
        await lockedHostedTypeScript(repo),
      ],
      { encoding: 'utf8', timeout: 120000 },
    );
    assert.equal(installed.status, 0, installed.stderr);
    const green = run();
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /HOSTED_D47_DRIVER_IMPORT_READY/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
