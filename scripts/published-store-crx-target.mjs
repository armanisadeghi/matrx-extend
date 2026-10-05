import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const PUBLISHED_STORE_CRX = Object.freeze({
  id: 'hnfolienncfklkgmdjjmhhegglimlamg',
  version: '0.2.205',
  crxSha256: '7f9fbe39a2807cfe4f9944713f512cf398994b377a104cc8011122982dacba23',
});

export async function requirePublishedStoreCrxTarget(requestedVersion, baselinePath) {
  assert.equal(
    requestedVersion,
    PUBLISHED_STORE_CRX.version,
    'published_store_crx_workflow_version_mismatch',
  );
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  assert.equal(
    baseline.publishedVersion,
    PUBLISHED_STORE_CRX.version,
    'published_store_crx_baseline_version_mismatch',
  );
  assert.equal(
    baseline.itemId,
    PUBLISHED_STORE_CRX.id,
    'published_store_crx_baseline_item_mismatch',
  );
  return PUBLISHED_STORE_CRX;
}
