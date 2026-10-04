import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { stopOwnedChild } from './native-sidepanel-qa-harness.mjs';

test('native profile cleanup waits for owned child exit after SIGKILL escalation', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    process.on('SIGTERM', () => {});
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  try {
    await new Promise((done, reject) => {
      child.stdout.once('data', done);
      child.once('error', reject);
    });
    await stopOwnedChild(child);
    assert.equal(child.signalCode, 'SIGKILL');
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
