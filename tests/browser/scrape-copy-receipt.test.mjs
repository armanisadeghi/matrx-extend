import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Break: a later section's failed copy target bypasses capture-only diagnostics.
for (const title of ['Copy capture', 'Copy images']) {
  test(`native receipt preserves the actual ${title} pointer failure`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scrape-copy-receipt-'));
    const output = join(directory, 'receipt.json');
    try {
      const result = spawnSync(
        process.execPath,
        [resolve(import.meta.dirname, 'scrape-guest-native-acceptance.mjs')],
        {
          env: {
            ...process.env,
            MATRX_SCRAPE_RECEIPT_SELF_TEST: '1',
            MATRX_SCRAPE_RECEIPT_SELF_TEST_OUTPUT: output,
            MATRX_SCRAPE_COPY_RECEIPT_SELF_TEST: title,
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, 1, result.stderr);
      const report = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(report.status, 'unverified');
      assert.equal(report.artifact, null);
      assert.deepEqual(report.failure, {
        stage: 'guest_copy_after_navigation',
        code: 'unique visible pointer target',
      });
      assert.equal(report.driver_failure.code, 'pointer_target_not_unique');
      assert.equal(report.driver_failure.matchedTargetCount, 0);
      assert.deepEqual(report.copy_batch_failure, {
        fixtureKey: 'referrals',
        action: { stage: 'open_menu', title, option: 'Markdown' },
        completed:
          title === 'Copy images'
            ? [
                {
                  title: 'Copy capture',
                  option: 'Page URL',
                  menuCorrect: true,
                  copied: { read: true, sentinelReplaced: true, formatCorrect: true },
                  permissionRestored: true,
                },
              ]
            : [],
      });
      assert.equal(report.copy_target_context.activeScrapePanel, true);
      assert.equal(report.copy_target_context.copyAriaLabelCount, title === 'Copy images' ? 1 : 0);
      assert.equal(JSON.stringify(report).includes('PRIVATE_PAGE_BODY'), false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
