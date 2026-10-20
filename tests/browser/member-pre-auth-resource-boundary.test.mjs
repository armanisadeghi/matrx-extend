import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Execute the actual reviewer auth prefix so moving page creation ahead of
// resource admission makes this test fail before any login can begin.
const reviewerSource = await readFile(
  new URL('./reviewer-chat-store-acceptance.mjs', import.meta.url),
  'utf8',
);
const start = reviewerSource.indexOf('    exercisePanel: async (native) => {');
const end = reviewerSource.indexOf('      let memberTransport = null;', start);
assert.ok(start >= 0 && end > start, 'reviewer auth entry must be found');
const prefix = reviewerSource.slice(start + '    exercisePanel: async (native) => {'.length, end);
const run = new Function(
  'native',
  'report',
  'recordMemberAuthTopologyBoundary',
  'OUTPUT',
  'writeReviewerReport',
  'MAGIC_LINK',
  'stage',
  `return (async () => { ${prefix} })()`,
);

for (const resourceReady of [false, true]) {
  test(`reviewer auth page waits for canonical resource health, ready=${resourceReady}`, async () => {
    const operations = [];
    const native = {
      page: {
        context: () => ({
          newPage: async () => {
            operations.push('auth_page_created');
            return {};
          },
        }),
      },
      panel: {},
      artifacts: '/tmp',
      requireResourceHealth: async () => {
        operations.push('resource_checked');
        if (!resourceReady) throw new Error('NATIVE_RESOURCE_BOUNDARY_REFUSED:cpu_pending');
      },
    };
    const entry = run(
      native,
      {},
      async () => {},
      '/tmp/unused',
      async () => {},
      null,
      'owned_profile',
    );
    if (resourceReady) await entry;
    else await assert.rejects(entry, /NATIVE_RESOURCE_BOUNDARY_REFUSED:cpu_pending/);
    assert.deepEqual(
      operations,
      resourceReady ? ['resource_checked', 'auth_page_created'] : ['resource_checked'],
    );
  });
}
