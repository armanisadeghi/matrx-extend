import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  runNativeSidepanelQa,
  verifyNativeExpectedRelease,
} from './native-sidepanel-qa-harness.mjs';

const receipt = {
  kind: 'ci_development_test_promotion',
  sourceSha: 'fe631ec14c443d025dec04c1fa00795b1feaddb0',
};
test('native gate rejects missing or wrong explicitly pinned SHA before browser startup', async () => {
  for (const sourceSha of [undefined, 'a'.repeat(40)]) {
    await assert.rejects(
      verifyNativeExpectedRelease({
        receipt,
        localDevReceiptPath: new URL(
          '../../test-results/ci-dev-promotion-receipt.json',
          import.meta.url,
        ).pathname,
        extensionDir: new URL('../../.output/chrome-mv3-dev', import.meta.url).pathname,
        expectedRelease: { sourceSha },
      }),
      /ci_dev_promotion_identity_refused/,
    );
  }
});

// The native gate owns routing, expected identity comparison, and pre-startup ordering.
// Its external verifier is replaced here; verifier filesystem behavior is guarded separately.
const source = readFileSync(new URL('./native-sidepanel-qa-harness.mjs', import.meta.url), 'utf8');
const body = source
  .slice(
    source.indexOf('export async function verifyNativeExpectedRelease('),
    source.indexOf('async function verifyReleasedArtifact('),
  )
  .replace('export ', '');
const identity = {
  kind: receipt.kind,
  sourceSha: receipt.sourceSha,
  version: '0.2.509',
  treeSha256: '2f71dec09b54bb524ee1bf852a7767abed3bc9b49658923f3175a66e9703232a',
  extensionId: 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
  runId: 38316843884,
  runAttempt: 1,
  artifactId: 11777408625,
};
function seam() {
  const calls = [];
  const gate = runInNewContext(`${body}; verifyNativeExpectedRelease`, {
    EXPECTED_EXTENSION_ID: identity.extensionId,
    verifyCiDevPromotionReceipt: async (input) => {
      calls.push(input);
      return { ...identity };
    },
    resolveExpectedRelease: () => {
      throw new Error('unexpected_local_receipt_route');
    },
  });
  return { gate, calls };
}
test('shared native gate preserves the verified CI identity and routes its pinned inputs', async () => {
  const { gate, calls } = seam();
  const result = await gate({
    receipt,
    extensionDir: '/owned/promoted',
    localDevReceiptPath: '/owned/promotion.json',
    expectedRelease: identity,
  });
  assert.deepEqual(result, identity);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedSourceSha, receipt.sourceSha);
  assert.equal(calls[0].extensionDir, '/owned/promoted');
  assert.equal(calls[0].receiptPath, '/owned/promotion.json');
});
for (const key of [
  'kind',
  'sourceSha',
  'version',
  'treeSha256',
  'extensionId',
  'runId',
  'runAttempt',
  'artifactId',
]) {
  test(`native gate refuses mismatched expected ${key}`, async () => {
    const { gate } = seam();
    await assert.rejects(
      gate({ receipt, expectedRelease: { ...identity, [key]: 'wrong' } }),
      /ci_dev_promotion_identity_refused/,
    );
  });
}
test('runNativeSidepanelQa refuses unverified promotion before runtime or browser startup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'native-promotion-gate-'));
  const receiptPath = join(root, 'ci-dev-promotion-receipt.json');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  const stages = [];
  try {
    await assert.rejects(
      runNativeSidepanelQa({
        localDevReceiptPath: receiptPath,
        expectedRelease: identity,
        onStage: (value) => stages.push(value),
      }),
      /ci_dev_promotion_identity_refused/,
    );
    assert.deepEqual(stages, ['receipt']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
