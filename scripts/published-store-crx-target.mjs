import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const PUBLISHED_STORE_CRX = Object.freeze({
  id: 'hnfolienncfklkgmdjjmhhegglimlamg',
  version: '0.2.577',
  crxSha256: '45802ce7241dfbd5f4053bd98443f9617ac60fe6ec9b4443b7c82d18d1ff2a11',
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
