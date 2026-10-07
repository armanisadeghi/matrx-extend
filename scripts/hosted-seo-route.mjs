import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';

export function hostedGuestSeoRoute(acceptanceCase, artifactMode, prepared) {
  if (acceptanceCase !== 'guest-seo') return null;
  assert.equal(artifactMode, 'development', 'hosted_seo_development_mode_required');
  assert.equal(prepared?.kind, 'ci_development_test', 'hosted_seo_ci_receipt_required');
  assert.equal(prepared?.eligibleStore, false, 'hosted_seo_store_artifact_refused');
  assert.ok(prepared.extensionDir?.startsWith('/'), 'hosted_seo_extension_dir_required');
  assert.ok(prepared.relocatedReceipt?.startsWith('/'), 'hosted_seo_receipt_path_required');
  assert.equal(
    dirname(prepared.extensionDir),
    dirname(prepared.relocatedReceipt),
    'hosted_seo_selected_artifact_mismatch',
  );
  assert.equal(prepared.extensionDir, join(dirname(prepared.relocatedReceipt), 'chrome-mv3'));
  return {
    driver: 'tests/browser/seo-guest-acceptance.mjs',
    env: {
      SEO_GUEST_EXTENSION_DIR: prepared.extensionDir,
      SEO_GUEST_DEV_BUILD_RECEIPT: prepared.relocatedReceipt,
    },
  };
}
