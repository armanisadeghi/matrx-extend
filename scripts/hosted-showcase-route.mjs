import assert from 'node:assert/strict';
import { join } from 'node:path';

export function hostedShowcaseRoute(
  acceptanceCase,
  prepared,
  runner,
  d47ResponseOrder = 'current-first',
) {
  if (
    ![
      'showcase-picker-admin',
      'showcase-stale-admin',
      'showcase-d47-admin',
      'showcase-d47-public-admin',
    ].includes(acceptanceCase)
  )
    return null;
  if (acceptanceCase === 'showcase-d47-admin')
    assert.ok(
      ['current-first', 'old-first', 'stale-only', 'manual-prior', 'prior-saved'].includes(
        d47ResponseOrder,
      ),
      'd47_response_order_invalid',
    );
  assert.equal(prepared.kind, 'ci_development_test', 'showcase_ci_artifact_required');
  assert.match(prepared.sourceSha ?? '', /^[a-f0-9]{40}$/, 'showcase_ci_source_required');
  assert.match(String(prepared.runId ?? ''), /^[1-9][0-9]*$/, 'showcase_ci_run_required');
  assert.match(String(prepared.artifactId ?? ''), /^[1-9][0-9]*$/, 'showcase_ci_artifact_required');
  assert.ok(prepared.extensionDir && prepared.relocatedReceipt, 'showcase_receipt_required');
  assert.ok(runner.temp && runner.runId && runner.attempt, 'showcase_hosted_output_required');
  return {
    driver:
      acceptanceCase === 'showcase-d47-admin'
        ? 'tests/browser/showcase-d47-document-lifecycle.mjs'
        : acceptanceCase === 'showcase-d47-public-admin'
          ? 'tests/browser/showcase-d47-public-initial-load.mjs'
          : 'tests/browser/showcase-picker-native-acceptance.mjs',
    env: {
      MATRX_SHOWCASE_EXTENSION_DIR: prepared.extensionDir,
      MATRX_SHOWCASE_RECEIPT: prepared.relocatedReceipt,
      MATRX_SHOWCASE_CI_SOURCE_SHA: prepared.sourceSha,
      MATRX_SHOWCASE_CI_RUN_ID: String(prepared.runId),
      MATRX_SHOWCASE_CI_ARTIFACT_ID: String(prepared.artifactId),
      MATRX_SHOWCASE_OUTPUT: join(
        runner.temp,
        `${acceptanceCase === 'showcase-d47-admin' ? 'showcase-d47-native' : acceptanceCase === 'showcase-d47-public-admin' ? 'showcase-d47-public-native' : 'showcase-picker-native'}-${runner.runId}-${runner.attempt}.json`,
      ),
      MATRX_SHOWCASE_STALE_BOUNDARY: acceptanceCase === 'showcase-stale-admin' ? '1' : undefined,
      MATRX_D47_RESPONSE_ORDER:
        acceptanceCase === 'showcase-d47-admin' ? d47ResponseOrder : undefined,
    },
  };
}
