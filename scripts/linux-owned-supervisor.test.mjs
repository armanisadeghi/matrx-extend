import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
for (const scenario of [
  'natural',
  'cancel',
  'pre_cancel',
  'escalate',
  'descendant',
  'unsupported',
  'invalid',
  'denied',
  'permission_signal',
  'esrch',
  'unconfirmed',
  'census_omission',
  'reap_storm',
]) {
  test(`owned supervisor actual functions: ${scenario}`, () => {
    const result = spawnSync(
      'python3',
      [new URL('./supervisor_unit.py', import.meta.url).pathname, scenario],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /PASS/);
  });
}
for (const scenario of [
  'natural',
  'descendant',
  'churn',
  'escalate',
  'cancel',
  'pre_cancel',
  'stale-handle',
]) {
  test(
    `Linux kernel owned lifecycle: ${scenario}`,
    {
      skip:
        process.platform !== 'linux'
          ? 'Requires actual Linux kernel; no macOS kernel proof'
          : false,
    },
    () => {
      const result = spawnSync(
        'python3',
        [new URL('./supervisor_kernel.py', import.meta.url).pathname, scenario],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const evidence = JSON.parse(result.stdout);
      assert.equal(evidence.case, scenario);
      console.log('LINUX_OWNED_KERNEL', JSON.stringify(evidence));
    },
  );
}
