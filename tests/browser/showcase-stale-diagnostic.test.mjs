import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createShowcaseStaleDiagnostic,
  runShowcaseStaleDiagnosticStep,
} from './showcase-stale-diagnostic.mjs';

test('failed stale relay wait retains fixed target and bounded last observation', async () => {
  const diagnostic = createShowcaseStaleDiagnostic('detected');
  let samples = 0;
  await assert.rejects(
    runShowcaseStaleDiagnosticStep(
      diagnostic,
      'A_stamped',
      async () => {
        samples += 1;
        return {
          overlay_count: samples === 1 ? 1 : 0,
          held_count: 0,
          A_stamped: false,
          raw_page_text: 'private@example.invalid',
          relay_count: 10001,
        };
      },
      async () => {
        throw new Error('A_stamped_not_observed:private@example.invalid?token=secret');
      },
    ),
    /A_stamped_not_observed/,
  );
  assert.equal(samples, 2);
  assert.deepEqual(diagnostic, {
    channel: 'detected',
    target: 'A_stamped',
    failed_target: 'A_stamped',
    last_safe: { overlay_count: 0, held_count: 0, A_stamped: false },
  });
  assert.equal(JSON.stringify(diagnostic).includes('private@example.invalid'), false);
  assert.equal(JSON.stringify(diagnostic).includes('token=secret'), false);
});

test('stale diagnostic refuses unfixed target labels', async () => {
  const diagnostic = createShowcaseStaleDiagnostic('result');
  await assert.rejects(
    runShowcaseStaleDiagnosticStep(
      diagnostic,
      'private@example.invalid',
      async () => ({}),
      async () => {},
    ),
    /invalid_stale_target/,
  );
  assert.equal(diagnostic.target, null);
});

test('lifecycle failure keeps only the failing operation and bounded counts', async () => {
  for (const channel of ['cancel', 'install', 'reinject']) {
    const diagnostic = createShowcaseStaleDiagnostic(channel);
    await assert.rejects(
      runShowcaseStaleDiagnosticStep(
        diagnostic,
        'lifecycle_A_release',
        async () => ({
          panel_picking: true,
          install_held: true,
          cancel_count: 1,
          install_count: 2,
          raw_selector: '#private-account',
        }),
        async () => {
          throw new Error('secret-value@example.invalid');
        },
      ),
      /secret-value/,
    );
    assert.deepEqual(diagnostic, {
      channel,
      target: 'lifecycle_A_release',
      failed_target: 'lifecycle_A_release',
      last_safe: { panel_picking: true, install_held: true, cancel_count: 1, install_count: 2 },
    });
    assert.equal(JSON.stringify(diagnostic).includes('private-account'), false);
    assert.equal(JSON.stringify(diagnostic).includes('secret-value'), false);
  }
});

test('native receipt preserves stale channel and failed wait without error text', () => {
  const directory = mkdtempSync(
    join(process.env.MATRX_TEST_EXTERNAL_TMPDIR ?? tmpdir(), 'showcase-stale-'),
  );
  try {
    for (const channel of ['detected', 'result']) {
      const output = join(directory, `${channel}.json`);
      const run = spawnSync(
        process.execPath,
        [new URL('./showcase-picker-native-acceptance.mjs', import.meta.url).pathname],
        {
          env: {
            ...process.env,
            MATRX_SHOWCASE_DIAGNOSTIC_PROBE: `stale_${channel}_wait`,
            MATRX_SHOWCASE_OUTPUT: output,
          },
          encoding: 'utf8',
        },
      );
      assert.equal(run.status, 1);
      const raw = readFileSync(output, 'utf8');
      const receipt = JSON.parse(raw);
      assert.equal(receipt.stage, `release_A_${channel}`);
      assert.equal(receipt.failure_code, `release_A_${channel}_failed`);
      assert.deepEqual(receipt.stale_diagnostic, {
        channel,
        target: 'A_stamped',
        failed_target: 'A_stamped',
        last_safe: { overlay_count: 1, held_count: 0, panel_picking: true, A_stamped: false },
      });
      assert.equal(raw.includes('private@example.invalid'), false);
      assert.equal(raw.includes('token=secret'), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native receipt keeps exact lifecycle failure targets without raw browser text', () => {
  const directory = mkdtempSync(
    join(process.env.MATRX_TEST_EXTERNAL_TMPDIR ?? tmpdir(), 'showcase-lifecycle-'),
  );
  try {
    for (const channel of ['cancel', 'install', 'reinject']) {
      const output = join(directory, `${channel}.json`);
      const run = spawnSync(
        process.execPath,
        [new URL('./showcase-picker-native-acceptance.mjs', import.meta.url).pathname],
        {
          env: {
            ...process.env,
            MATRX_SHOWCASE_DIAGNOSTIC_PROBE: `lifecycle_${channel}_wait`,
            MATRX_SHOWCASE_OUTPUT: output,
          },
          encoding: 'utf8',
        },
      );
      assert.equal(run.status, 1);
      const raw = readFileSync(output, 'utf8');
      const receipt = JSON.parse(raw);
      assert.equal(receipt.stage, `lifecycle_${channel}`);
      assert.deepEqual(receipt.lifecycle_diagnostic, {
        channel,
        target: channel === 'reinject' ? 'lifecycle_reinject' : 'lifecycle_A_release',
        failed_target: channel === 'reinject' ? 'lifecycle_reinject' : 'lifecycle_A_release',
        last_safe: { panel_picking: true, overlay_count: 1, listener_click_count: 1 },
      });
      assert.equal(raw.includes('private@example.invalid'), false);
      assert.equal(raw.includes('token=secret'), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
