import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  PUBLISHED_STORE_CRX,
  requirePublishedStoreCrxTarget,
} from '../../scripts/published-store-crx-target.mjs';

test('published CRX target admits the approved baseline and refuses stale workflow token', async () => {
  const baselinePath = resolve('config/chrome-web-store-approved-baseline.json');
  assert.deepEqual(
    await requirePublishedStoreCrxTarget('0.2.205', baselinePath),
    PUBLISHED_STORE_CRX,
  );
  await assert.rejects(
    requirePublishedStoreCrxTarget('0.2.130', baselinePath),
    /published_store_crx_workflow_version_mismatch/,
  );
});

test('published CRX target refuses a stale approved baseline before download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'published-crx-target-'));
  try {
    const original = JSON.parse(
      await readFile(resolve('config/chrome-web-store-approved-baseline.json'), 'utf8'),
    );
    await writeFile(
      join(directory, 'baseline.json'),
      JSON.stringify({ ...original, publishedVersion: '0.2.176' }),
    );
    await assert.rejects(
      requirePublishedStoreCrxTarget('0.2.205', join(directory, 'baseline.json')),
      /published_store_crx_baseline_version_mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('published CRX target refuses another item in the approved baseline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'published-crx-item-'));
  try {
    const original = JSON.parse(
      await readFile(resolve('config/chrome-web-store-approved-baseline.json'), 'utf8'),
    );
    await writeFile(
      join(directory, 'baseline.json'),
      JSON.stringify({ ...original, itemId: 'pifjakncjcpnkjbdlijgddhiipdlfbde' }),
    );
    await assert.rejects(
      requirePublishedStoreCrxTarget('0.2.205', join(directory, 'baseline.json')),
      /published_store_crx_baseline_item_mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('hosted preflight rejects a stale workflow token before browser setup', () => {
  const run = spawnSync(process.execPath, [resolve('scripts/hosted-guest-acceptance.mjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MATRX_HOSTED_PHASE: 'preflight',
      MATRX_HOSTED_ACCEPTANCE_CASE: 'guest-chat',
      MATRX_HOSTED_PUBLISHED_STORE_CRX: '0.2.130',
    },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /published_store_crx_workflow_version_mismatch/);
});
